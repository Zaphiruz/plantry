#!/usr/bin/env bash
# One-time: put every Plantry secret into Vault (LC3) and deliver the app's Vault token to S2.
# Run this yourself, from the repo root, in Git Bash:   bash scripts/provision-secrets.sh
#
# Nothing secret is printed, written to this machine's disk, or put on a command line:
#   - you type the four things only you have (hidden input)
#   - SESSION_SECRET and the VAPID keypair are generated here, in memory
#   - the DB password and MinIO keys are read from the root-only files on S2 (OPERATIONS steps 9-10)
#   - everything travels over ssh stdin into `vault kv put`; the periodic app token travels
#     LC3 -> here (in a variable) -> S2:/root/.plantry-vault-token (mode 600)
#
# Prerequisites: `ssh S2` and `ssh LC3` work; Vault is unsealed; steps 9, 10 and 12 are done.
# Safe to re-run: the KV write is a full replace; an existing app token is reused, not duplicated.
set -euo pipefail

say() { printf '%s\n' "$*" >&2; }
ask_secret() { local v; read -r -s -p "$1: " v; echo >&2; printf '%s' "$v"; }
ask() { local v; read -r -p "$1: " v; printf '%s' "$v"; }

[ -f apps/backend/package.json ] || { say "Run from the repo root."; exit 1; }

say "== Things only you have (input is hidden) =="
VAULT_ROOT_TOKEN=$(ask_secret "Vault root token (1Password)")
OIDC_CLIENT_ID=$(ask "Authentik client ID (provider 'plantry')")
OIDC_CLIENT_SECRET=$(ask_secret "Authentik client secret")
GH_PAT=$(ask_secret "GitHub fine-grained PAT, Issues read/write on Zaphiruz/plantry (leave empty to skip feedback)")
VAPID_EMAIL=$(ask "Contact email for web push (VAPID subject, e.g. you@example.com)")
VAPID_EMAIL=${VAPID_EMAIL#mailto:}   # the mailto: prefix is added below; accept either form
[ -n "$VAULT_ROOT_TOKEN" ] && [ -n "$OIDC_CLIENT_ID" ] && [ -n "$OIDC_CLIENT_SECRET" ] && [ -n "$VAPID_EMAIL" ] \
  || { say "Vault token, client ID, client secret and email are required."; exit 1; }

say "== Generating SESSION_SECRET and VAPID keypair (in memory) =="
SESSION_SECRET=$(openssl rand -hex 32)
# Plain node + the already-installed web-push module (no corepack/pnpm: corepack 0.29 fails signature checks in some shells).
[ -d apps/backend/node_modules/web-push ] || { say "apps/backend/node_modules/web-push is missing - run 'pnpm install' first."; exit 1; }
VAPID_JSON=$(cd apps/backend && node --input-type=module -e "import wp from 'web-push'; console.log(JSON.stringify(wp.generateVAPIDKeys()))")
[ -n "$VAPID_JSON" ] || { say "VAPID key generation failed."; exit 1; }

say "== Reading DB password and MinIO keys from S2 =="
DB_PW=$(ssh -o BatchMode=yes S2 'cat /root/.plantry-db-pw')
S3_JSON=$(ssh -o BatchMode=yes S2 'cat /root/.plantry-s3.json')
[ -n "$DB_PW" ] && [ -n "$S3_JSON" ] || { say "Missing /root/.plantry-db-pw or /root/.plantry-s3.json on S2."; exit 1; }

say "== Building the secret document =="
export SESSION_SECRET VAPID_JSON DB_PW S3_JSON OIDC_CLIENT_ID OIDC_CLIENT_SECRET GH_PAT VAPID_EMAIL
KV_JSON=$(python - <<'PY'
import json, os
vapid = json.loads(os.environ["VAPID_JSON"]); s3 = json.loads(os.environ["S3_JSON"])
d = {
  "DATABASE_URL": f"postgresql://plantry:{os.environ['DB_PW']}@postgresql:5432/plantry",
  "SESSION_SECRET": os.environ["SESSION_SECRET"],
  "SESSION_COOKIE_SECURE": "true",
  "FRONTEND_ORIGIN": "https://plantry.wispy-nook.casa",
  "TRUST_PROXY_HOPS": "3",   # cloudflared -> nginx (both LC2) -> Caddy; Caddy trusts only LC2. Change if the chain changes.
  "AUTHENTIK_ISSUER_URL": "https://authentik.wispy-nook.casa/application/o/plantry/",
  "AUTHENTIK_CLIENT_ID": os.environ["OIDC_CLIENT_ID"],
  "AUTHENTIK_CLIENT_SECRET": os.environ["OIDC_CLIENT_SECRET"],
  "AUTHENTIK_REDIRECT_URI": "https://plantry.wispy-nook.casa/api/auth/callback",
  "AUTHENTIK_ADMIN_GROUP": "plantry-admins",
  "VAPID_PUBLIC_KEY": vapid["publicKey"],
  "VAPID_PRIVATE_KEY": vapid["privateKey"],
  "VAPID_SUBJECT": "mailto:" + os.environ["VAPID_EMAIL"],
  "S3_ENDPOINT": "http://192.168.40.20:9002",
  "S3_PUBLIC_ENDPOINT": "https://dinner-club-media.wispy-nook.casa",
  "S3_REGION": "us-east-1",
  "S3_BUCKET": "plantry-media",
  "S3_ACCESS_KEY": s3["accessKey"],
  "S3_SECRET_KEY": s3["secretKey"],
}
if os.environ.get("GH_PAT"):
  d["GITHUB_FEEDBACK_TOKEN"] = os.environ["GH_PAT"]
  d["GITHUB_FEEDBACK_REPO"] = "Zaphiruz/plantry"
print(json.dumps(d))
PY
)

say "== Writing policy + secrets to Vault on LC3, creating the periodic app token =="
# stdin to LC3: line 1 = root token, line 2 = the JSON document. stdout from LC3 = ONLY the app token.
APP_TOKEN=$(printf '%s\n%s\n' "$VAULT_ROOT_TOKEN" "$KV_JSON" | ssh -o BatchMode=yes LC3 '
  set -euo pipefail
  export VAULT_ADDR=http://127.0.0.1:8200
  read -r VAULT_TOKEN; export VAULT_TOKEN
  umask 077; tmp=$(mktemp -p /dev/shm plantry.XXXXXX); trap "rm -f $tmp" EXIT
  cat > "$tmp"
  vault token lookup >/dev/null || { echo "Vault rejected the root token" >&2; exit 1; }
  printf "path \"secret/data/plantry\" { capabilities = [\"read\"] }\n" | vault policy write plantry - >&2
  vault kv put secret/plantry @"$tmp" >/dev/null && echo "kv written: $(python3 -c "import json,sys;print(len(json.load(open(sys.argv[1]))))" "$tmp") keys" >&2
  if ! grep -q "^plantry " /opt/vault/app-tokens 2>/dev/null; then
    bash /opt/vault/add-app-token.sh plantry plantry >&2
  else
    echo "app token for plantry already exists - reusing it" >&2
  fi
  grep "^plantry " /opt/vault/app-tokens | tail -1 | cut -d" " -f2
')
[ -n "$APP_TOKEN" ] || { say "No app token came back from LC3."; exit 1; }

say "== Delivering the app token to S2:/root/.plantry-vault-token (mode 600) =="
printf '%s' "$APP_TOKEN" | ssh -o BatchMode=yes S2 'umask 077; cat > /root/.plantry-vault-token; echo "written: $(stat -c "%a %U %s bytes" /root/.plantry-vault-token)" >&2'

say "== Verifying the app token can read the secret (from S2, through the same URL the container uses) =="
ssh -o BatchMode=yes S2 '
  code=$(curl -s -o /dev/null -w "%{http_code}" --cacert /usr/local/share/ca-certificates/cloudflare-origin-ca.crt \
    -H "X-Vault-Token: $(cat /root/.plantry-vault-token)" https://vault.wispy-nook.casa/v1/secret/data/plantry)
  echo "GET secret/data/plantry with the app token -> HTTP $code (want 200)" >&2'

unset VAULT_ROOT_TOKEN OIDC_CLIENT_SECRET GH_PAT SESSION_SECRET VAPID_JSON DB_PW S3_JSON KV_JSON APP_TOKEN
say "Done. Next: OPERATIONS step 14 (clone to /opt/plantry, move the token into place, register the runner)."
