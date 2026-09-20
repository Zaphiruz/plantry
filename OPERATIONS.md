# Plantry — Operations

This document is the runbook for provisioning, deploying, and operating Plantry in production. Sections B and C below are the one-time setup and first-deploy procedures; the rest of this file covers day-2 operations.

## B. Provision (one-time; user-confirmed, user supplies secrets)

- [ ] **Step 8: GitHub**

Create a **private** repo (self-hosted runner + public repo = arbitrary code execution risk via fork PRs — see the 2026-07-08 note in the homelab doc). Push `main`. Set fork-PR approval to "all external contributors" anyway. Create the two labels the feedback feature uses:
```bash
gh label create feedback --repo Zaphiruz/plantry --color 0E8A16
gh label create user-submitted --repo Zaphiruz/plantry --color 1D76DB
```
Create a fine-grained PAT limited to this repo with **Issues: read & write** only → this becomes `GITHUB_FEEDBACK_TOKEN`.

- [ ] **Step 9: PostgreSQL (S2)**

```bash
docker exec shared-infra-postgresql-1 psql -U postgres -c "CREATE USER plantry WITH PASSWORD '<generated>';"
docker exec shared-infra-postgresql-1 psql -U postgres -c "CREATE DATABASE plantry OWNER plantry TEMPLATE template0;"
docker exec shared-infra-postgresql-1 psql -U postgres -d plantry -c "
  GRANT ALL PRIVILEGES ON SCHEMA public TO plantry;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO plantry;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO plantry;"
```
(`TEMPLATE template0` sidesteps the known `template1` collation-version mismatch on this server.)

- [ ] **Step 10: MinIO bucket + scoped service account (S2)**

```bash
docker exec -it dinner-club-minio-1 sh
mc alias set local http://localhost:9000 dinnerclub "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing local/plantry-media
cat > /tmp/plantry-policy.json <<'EOF'
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": ["arn:aws:s3:::plantry-media"] },
  { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": ["arn:aws:s3:::plantry-media/*"] } ] }
EOF
mc admin user svcacct add local dinnerclub --name plantry --policy /tmp/plantry-policy.json
```
Record the printed access/secret key for Vault. Confirm which public hostname fronts this MinIO — the homelab doc says `media.dinner-club.wispy-nook.casa`, Dinner Club's prod compose says `dinner-club-media.wispy-nook.casa`:
```bash
grep MINIO_SERVER_URL /opt/dinner-club/docker-compose.prod.yml
```
Use that value as `S3_PUBLIC_ENDPOINT`, and fix whichever document is wrong. **Checked 2026-09-19: the live value is `https://dinner-club-media.wispy-nook.casa`** (the homelab doc's `media.dinner-club…` is the stale one).

- [ ] **Step 11: VAPID keys**

On the dev machine: `pnpm --filter @plantry/backend exec web-push generate-vapid-keys` → `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`. `VAPID_SUBJECT=mailto:<your address>`.

- [ ] **Step 12: Authentik**

In `https://authentik.wispy-nook.casa` (admin):
1. Groups: create `plantry-users`, `plantry-admins`; add yourself to both.
2. Provider → OAuth2/OpenID: name `plantry`, **Confidential**, redirect URI (strict) `https://plantry.wispy-nook.casa/api/auth/callback`, signing key = the default RS256 cert, **leave Encryption Key blank**, scopes: `openid`, `email`, `profile`, and the custom `groups` scope mapping (the one using `request.user.groups`).
3. Application: name `Plantry`, slug `plantry`, provider `plantry`, launch URL `https://plantry.wispy-nook.casa/`. Bind group `plantry-users` under Policy/Group/User Bindings (this is the app-access gate).
4. Note client id/secret. Issuer = `https://authentik.wispy-nook.casa/application/o/plantry/`.
5. The backend requests the groups scope by the name `goauthentik.io/providers/oauth2/scope-groups` (inherited from Velvet Scoop's `oidc.ts`). If, after first login, `/api/me` shows `isAdmin: false` for a `plantry-admins` member, the scope name on this Authentik differs — check what Velvet Scoop's provider has selected and align `scopesExtra` in `createOidcClient`.

Do **not** set timezone env vars on Authentik's containers (breaks token validation). Plantry's own `TZ` is unrelated and fine.

- [ ] **Step 13: Vault (LC3, unsealed, root token)**

```bash
vault policy write plantry - <<EOF
path "secret/data/plantry" { capabilities = ["read"] }
EOF
vault kv put secret/plantry \
  DATABASE_URL='postgresql://plantry:<pw>@postgresql:5432/plantry' \
  SESSION_SECRET='<64 random hex>' SESSION_COOKIE_SECURE='true' \
  FRONTEND_ORIGIN='https://plantry.wispy-nook.casa' \
  AUTHENTIK_ISSUER_URL='https://authentik.wispy-nook.casa/application/o/plantry/' \
  AUTHENTIK_CLIENT_ID='<id>' AUTHENTIK_CLIENT_SECRET='<secret>' \
  AUTHENTIK_REDIRECT_URI='https://plantry.wispy-nook.casa/api/auth/callback' \
  AUTHENTIK_ADMIN_GROUP='plantry-admins' TRUST_PROXY_HOPS='2' \
  VAPID_PUBLIC_KEY='<pub>' VAPID_PRIVATE_KEY='<priv>' VAPID_SUBJECT='mailto:<you>' \
  S3_ENDPOINT='http://192.168.40.20:9002' S3_PUBLIC_ENDPOINT='https://dinner-club-media.wispy-nook.casa' \
  S3_REGION='us-east-1' S3_BUCKET='plantry-media' S3_ACCESS_KEY='<svcacct>' S3_SECRET_KEY='<svcacct secret>' \
  GITHUB_FEEDBACK_TOKEN='<pat>' GITHUB_FEEDBACK_REPO='Zaphiruz/plantry'
bash /opt/vault/add-app-token.sh plantry plantry     # prints the periodic token; auto-registered for weekly renewal
```
Never put `AUTH_DEV_BYPASS` in Vault. The entrypoint ignores it (and `NODE_ENV`, `NODE_OPTIONS`,
`NODE_EXTRA_CA_CERTS`, `TZ`, `PATH`) if present, logging the ignored key names; the backend also
refuses to boot with the bypass in production.

`TRUST_PROXY_HOPS='2'` is the **hop count**, not a toggle. Requests reach the backend as
`client → nginx (edge) → Caddy (frontend container) → backend`, and each proxy *appends* to
`X-Forwarded-For`, so the address chain the backend sees is `[Caddy, nginx, client]`. Trusting
2 hops (Caddy and nginx) makes `req.ip` the real client address; trusting more would let a
client prepend a fake address and get a fresh rate-limit bucket per request. If the proxy
chain in front of Plantry changes, change this number to match — set it to `0` to fall back to
the peer address.

- [ ] **Step 14: S2 checkout, runner, token**

As `runner` on S2: create a deploy key (`~/.ssh/plantry-deploy`), add it read-only to the GitHub repo, add SSH host alias `github.com-plantry` in `~/.ssh/config` (copy the `github.com-velvet-scoop` block), then:
```bash
sudo mkdir -p /opt/plantry && sudo chown runner:runner /opt/plantry
git clone git@github.com-plantry:Zaphiruz/plantry.git /opt/plantry
cd /opt/plantry
( umask 077; printf '%s' '<token from step 13>' > vault-token ) && chmod 400 vault-token
bash fetch-secrets.sh
```
Register a runner in `/opt/actions-runner-plantry` exactly as the homelab doc describes (runner tarball → `./config.sh` with a fresh repo token as `runner` → `sudo ./svc.sh install runner && sudo ./svc.sh start`). Store the deploy key in Vault at `deploy-keys/plantry`.

- [ ] **Step 15: nginx (LC2) + Cloudflare Tunnel**

Append to `/etc/nginx/sites-enabled/wispy-nook.casa` on LC2:
```nginx
server {
    listen 443 ssl;
    server_name plantry.wispy-nook.casa;
    ssl_certificate     /etc/nginx/certs/cloudflare-origin.pem;
    ssl_certificate_key /etc/nginx/certs/cloudflare-origin.key;
    client_max_body_size 1m;
    location / {
        proxy_pass http://192.168.40.20:3008;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```
`nginx -t && systemctl reload nginx`. In Cloudflare Zero Trust → the existing tunnel → add Public Hostname `plantry.wispy-nook.casa` → `https://localhost:443`, Origin Server Name `plantry.wispy-nook.casa`. Do **not** add a Pi-hole local DNS override for it. (Photo bytes never traverse this vhost — they go browser → MinIO hostname — so 1 MB is plenty.)

## C. First deploy + production verification

- [ ] **Step 16: Deploy**

The Deploy workflow is **disabled** in GitHub (there was no self-hosted runner when the repo was created, so every green CI run queued a deploy job that could never start). Once the runner from step 14 is online, enable it:

```bash
gh workflow enable deploy.yml --repo Zaphiruz/plantry
gh workflow run deploy.yml --repo Zaphiruz/plantry
```

(or push to `main`). Watch the run; the health-check step must pass.

- [ ] **Step 17: Verify in production — every line must be checked off**

1. `https://plantry.wispy-nook.casa` → redirects to Authentik → back to the household picker. A user **not** in `plantry-users` is refused by Authentik.
2. Create a household, a store, an item with min stock; − / + work.
3. **PATCH through Cloudflare:** edit the item (this is a browser `PATCH`). If it fails with Cloudflare error 1010 (as Mealie's API does for non-browser clients), change the five `PATCH` routes + RTK endpoints to `PUT`, update the scoping-matrix `BODIES` keys, redeploy.
4. Photo: add one from a phone. If the PUT fails with a CORS or signature error, `S3_PUBLIC_ENDPOINT` is wrong (step 10). Confirm two objects in `plantry-media` via the MinIO console on S2:9003.
5. Install to home screen on a phone (on iOS this is mandatory for push), enable notifications in Settings, make an item low, force the daily job (see "Force the daily job now" below) → one digest notification; tapping opens the shopping list.
6. Tap-to-restock on the shopping list, then Undo.
7. Invite a second real user; they join and see the same data; household switcher works with two households.
8. As a `plantry-admins` member: archive an item → "Delete permanently" is visible and works. As a non-admin: it isn't shown.
9. Settings → Feedback → submit → an issue appears in the repo with labels `feedback` + `user-submitted`; close it as completed → within the hour (or after nudging `state_fetched_at`) it shows **done**.
10. Firefox on cellular (HTTP/3 is disabled at the Cloudflare edge for this zone — confirm API calls work, since this zone has history there).
11. Next morning after 06:00 ET: `docker compose -f docker-compose.prod.yml logs backend | grep "daily stage"` shows three `done` lines, and `SELECT * FROM job_runs;` has `last_run_at` ≈ 06:00 local — confirming `TZ` + `tzdata` work.

- [ ] **Step 18: Record it in the homelab doc**

In `D:\docs\mikrotik\CLAUDE.md`: add Plantry to the S2 row of "Hardware & IPs" (frontend port 3008), to `shared-infra` databases (`plantry`), to the Cloudflare Tunnel active hostnames, to Authentik groups (`plantry-users`, `plantry-admins`), a "Plantry" gotcha block in the same style as Velvet Scoop's (repo, runner path, Vault path + key list, MinIO bucket `plantry-media` on Dinner Club's instance with a scoped service account, daily job at 06:00 ET, feedback → GitHub issues), a row in "Internal Services", and a dated "Resolved" entry. Correct the MinIO hostname there if step 10 showed it was wrong.

- [ ] **Step 19: Final commit**

```bash
git add -A && git commit -m "docs: record production deployment details"
```

## Day-2 operations

**Logs:**
```bash
docker compose -f docker-compose.prod.yml logs -f backend
```
Daily-job lines contain `daily stage done` / `daily stage failed`.

**Force the daily job now:**
```bash
docker exec shared-infra-postgresql-1 psql -U postgres -d plantry -c "DELETE FROM job_runs;"
docker compose -f docker-compose.prod.yml restart backend
```
(boot catch-up runs it)

**Rotate a secret:**
```bash
vault kv patch secret/plantry KEY=value   # on LC3
docker compose -f docker-compose.prod.yml restart backend
```

**Backups:** the `plantry` DB is covered automatically by S2's nightly `pg_dumpall`. Photos live in Dinner Club's MinIO volume and are **not** in that chain; follow Dinner Club's `OPERATIONS.md` `mc mirror` procedure with bucket `plantry-media` if photo loss matters.

**Make someone an app admin:** add them to Authentik group `plantry-admins`; takes effect at their next login.

**Disk:** `docker builder prune -f` if builds start failing on space.
