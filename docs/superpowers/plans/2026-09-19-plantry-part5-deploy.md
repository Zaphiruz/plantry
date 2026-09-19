# Plantry Plan — Part 5: Deploy (Task 26)

Index + Global Constraints: [2026-09-19-plantry.md](2026-09-19-plantry.md). Homelab reference: `D:\docs\mikrotik\CLAUDE.md` ("Adding a new app (full checklist)"). Pattern source: `D:\code\Velvet Scoop\website-v2` (`Dockerfile`s, `entrypoint.mjs`, `docker-compose.prod.yml`, `.github/workflows/deploy.yml`, `OPERATIONS.md`).

> **Every step in "B. Provision" and "C. First deploy" changes shared production infrastructure (Authentik, Vault, PostgreSQL, MinIO, nginx, Cloudflare, GitHub).** An agent executing this plan must show the exact command and get the user's go-ahead before each one, and must never type secrets itself — the user generates/pastes secret values. Steps in "A. Repo artifacts" are ordinary code changes.

---

### Task 26: Containers, deploy workflow, runbook, first deploy

**Files:**
- Create: `apps/backend/Dockerfile`, `apps/backend/entrypoint.mjs`, `apps/frontend/Dockerfile`, `apps/frontend/Caddyfile`
- Create: `docker-compose.prod.yml`, `fetch-secrets.sh`, `.github/workflows/deploy.yml`, `OPERATIONS.md`, `README.md`
- Modify (after go-live): `D:\docs\mikrotik\CLAUDE.md`

**Interfaces:**
- Consumes: `pnpm --filter @plantry/backend build` → `apps/backend/dist/server.js`; `pnpm --filter @plantry/frontend build` → `apps/frontend/dist`; all env names from Global Constraints.
- Produces: images `plantry-backend`, `plantry-frontend`; containers `plantry-backend-1`, `plantry-frontend-1`; S2 port `3007`; `https://plantry.wispy-nook.casa`.

## A. Repo artifacts

- [ ] **Step 1: Backend image**

`apps/backend/Dockerfile`:
```dockerfile
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN pnpm --filter @plantry/backend exec prisma generate
RUN pnpm --filter @plantry/backend build

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl tzdata
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./
COPY --from=build /repo/apps/backend/dist apps/backend/dist
COPY --from=build /repo/apps/backend/package.json apps/backend/
COPY --from=build /repo/apps/backend/node_modules apps/backend/node_modules
COPY --from=build /repo/apps/backend/prisma apps/backend/prisma
COPY apps/backend/entrypoint.mjs apps/backend/entrypoint.mjs
EXPOSE 3000
CMD ["node", "apps/backend/entrypoint.mjs"]
```
(`tzdata` is required for `TZ=America/New_York` to take effect on Alpine — without it node-cron would fire at 06:00 UTC. `@plantry/shared` is bundled into `dist/server.js` by tsup, so `packages/shared` is not copied into the runtime stage.)

`apps/backend/entrypoint.mjs`:
```js
import { spawn } from 'node:child_process';

const { VAULT_ADDR, VAULT_TOKEN } = process.env;
if (!VAULT_ADDR || !VAULT_TOKEN) {
  console.error('[entrypoint] VAULT_ADDR and VAULT_TOKEN must be set');
  process.exit(1);
}
console.log('[entrypoint] Fetching secrets from Vault...');
const res = await fetch(`${VAULT_ADDR}/v1/secret/data/plantry`, { headers: { 'X-Vault-Token': VAULT_TOKEN } });
if (!res.ok) {
  console.error(`[entrypoint] Vault responded ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const { data: { data: secrets } } = await res.json();
Object.assign(process.env, secrets);
console.log('[entrypoint] Secrets loaded, starting server...');

const child = spawn(process.execPath, ['apps/backend/dist/server.js'], { stdio: 'inherit', env: process.env });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
```

- [ ] **Step 2: Frontend image**

`apps/frontend/Caddyfile`:
```
:80 {
  encode gzip zstd

  handle /api/* {
    reverse_proxy backend:3000
  }

  # Service worker + manifest must never be cached, or clients get stuck on old builds.
  @nocache path /sw.js /manifest.webmanifest /index.html
  header @nocache Cache-Control "no-cache"

  handle {
    root * /srv
    try_files {path} /index.html
    file_server
  }
}
```

`apps/frontend/Dockerfile`:
```dockerfile
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/frontend/package.json apps/frontend/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/frontend apps/frontend
RUN pnpm --filter @plantry/frontend exec vite build

FROM caddy:2-alpine AS runtime
COPY apps/frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/frontend/dist /srv
EXPOSE 80
```

- [ ] **Step 3: Production compose + secret fetch script**

`docker-compose.prod.yml`:
```yaml
services:
  backend:
    build: { context: ., dockerfile: apps/backend/Dockerfile }
    image: plantry-backend:latest
    restart: unless-stopped
    env_file: .env            # VAULT_ADDR + VAULT_TOKEN only; everything else comes from Vault at start
    environment:
      TZ: America/New_York
      NODE_EXTRA_CA_CERTS: /etc/ssl/extra/cloudflare-ca.crt
    volumes:
      - /usr/local/share/ca-certificates/cloudflare-origin-ca.crt:/etc/ssl/extra/cloudflare-ca.crt:ro
    networks: [default, shared-db]

  frontend:
    build: { context: ., dockerfile: apps/frontend/Dockerfile }
    image: plantry-frontend:latest
    restart: unless-stopped
    depends_on: [backend]
    ports: ["3007:80"]

networks:
  shared-db:
    external: true
```

`fetch-secrets.sh` (run on S2 as `runner`; mirrors Two Cents):
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
umask 077
printf 'VAULT_ADDR=https://vault.wispy-nook.casa\nVAULT_TOKEN=%s\n' "$(cat vault-token)" > .env
echo ".env written"
```

- [ ] **Step 4: Local image smoke test**

```bash
docker compose -f docker-compose.prod.yml build
docker run --rm plantry-backend:latest node -e "import('/repo/apps/backend/dist/server.js').catch(e => { console.log(String(e).slice(0,120)); })"
docker run --rm -p 8099:80 --add-host backend:127.0.0.1 plantry-frontend:latest &
curl -sI localhost:8099/ | head -1 ; curl -sI localhost:8099/sw.js | grep -i cache-control
```
Expected: build succeeds; the backend one-liner prints `Error: Missing required environment variable: DATABASE_URL` (proves the bundle loads and config runs); frontend returns `HTTP/1.1 200 OK` and `Cache-Control: no-cache` for `sw.js`. Stop the container.

- [ ] **Step 5: Deploy workflow (runs only after CI is green on `main`)**

`.github/workflows/deploy.yml`:
```yaml
name: Deploy
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch: {}

concurrency: { group: deploy, cancel-in-progress: false }

jobs:
  deploy:
    if: ${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}
    runs-on: self-hosted
    defaults: { run: { working-directory: /opt/plantry } }
    steps:
      - name: Pull latest code
        run: git pull --ff-only

      - name: Build images
        run: |
          set -e
          for i in 1 2 3; do
            if docker compose -f docker-compose.prod.yml build backend frontend; then exit 0; fi
            echo "Attempt $i failed, retrying..."; sleep 10
          done
          echo "Build failed after 3 attempts."; exit 1

      - name: Run migrations (before the new code starts)
        run: |
          source .env
          DB_URL=$(curl -sf -H "X-Vault-Token: $VAULT_TOKEN" "$VAULT_ADDR/v1/secret/data/plantry" \
            | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['data']['DATABASE_URL'])")
          docker compose -f docker-compose.prod.yml run --rm --no-deps -e DATABASE_URL="$DB_URL" backend \
            apps/backend/node_modules/.bin/prisma migrate deploy --schema apps/backend/prisma/schema.prisma

      - name: Deploy
        run: docker compose -f docker-compose.prod.yml up -d

      - name: Health check
        run: |
          for i in $(seq 1 20); do
            if curl -sf http://localhost:3007/api/me -o /dev/null -w '%{http_code}' | grep -q 401; then echo healthy; exit 0; fi
            sleep 3
          done
          docker compose -f docker-compose.prod.yml logs --tail 80 backend; exit 1

      - name: Prune dangling images (S2 has a 64 GB disk)
        run: docker image prune -f
```
(`/api/me` returning **401** through Caddy proves frontend → backend → Vault → PostgreSQL all work.)

- [ ] **Step 6: `OPERATIONS.md` + `README.md`**

Write `OPERATIONS.md` containing sections B and C below verbatim (they are the runbook), plus:
- **Logs:** `docker compose -f docker-compose.prod.yml logs -f backend`; daily-job lines contain `daily stage done` / `daily stage failed`.
- **Force the daily job now:** `docker exec shared-infra-postgresql-1 psql -U postgres -d plantry -c "DELETE FROM job_runs;"` then `docker compose -f docker-compose.prod.yml restart backend` (boot catch-up runs it).
- **Rotate a secret:** `vault kv patch secret/plantry KEY=value` on LC3 → `docker compose -f docker-compose.prod.yml restart backend`.
- **Backups:** the `plantry` DB is covered automatically by S2's nightly `pg_dumpall`. Photos live in Dinner Club's MinIO volume and are **not** in that chain; follow Dinner Club's `OPERATIONS.md` `mc mirror` procedure with bucket `plantry-media` if photo loss matters.
- **Make someone an app admin:** add them to Authentik group `plantry-admins`; takes effect at their next login.
- **Disk:** `docker builder prune -f` if builds start failing on space.

Write `README.md`: one-paragraph description, link to the spec and plan, and the dev quick-start:
```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm --filter @plantry/backend prisma migrate dev
pnpm --filter @plantry/backend test:db:setup
pnpm dev     # http://localhost:5173/api/auth/dev-login?sub=me&name=Me&admin=1
pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: production images, deploy workflow, operations runbook"
```

## B. Provision (one-time; user-confirmed, user supplies secrets)

- [ ] **Step 8: GitHub**

Create a **private** repo (self-hosted runner + public repo = arbitrary code execution risk via fork PRs — see the 2026-07-08 note in the homelab doc). Push `main`. Set fork-PR approval to "all external contributors" anyway. Create the two labels the feedback feature uses:
```bash
gh label create feedback --repo <owner>/plantry --color 0E8A16
gh label create user-submitted --repo <owner>/plantry --color 1D76DB
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
Use that value as `S3_PUBLIC_ENDPOINT`, and fix whichever document is wrong.

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
  AUTHENTIK_ADMIN_GROUP='plantry-admins' \
  VAPID_PUBLIC_KEY='<pub>' VAPID_PRIVATE_KEY='<priv>' VAPID_SUBJECT='mailto:<you>' \
  S3_ENDPOINT='http://192.168.40.20:9002' S3_PUBLIC_ENDPOINT='https://<confirmed in step 10>' \
  S3_REGION='us-east-1' S3_BUCKET='plantry-media' S3_ACCESS_KEY='<svcacct>' S3_SECRET_KEY='<svcacct secret>' \
  GITHUB_FEEDBACK_TOKEN='<pat>' GITHUB_FEEDBACK_REPO='<owner>/plantry'
bash /opt/vault/add-app-token.sh plantry plantry     # prints the periodic token; auto-registered for weekly renewal
```
Never put `AUTH_DEV_BYPASS` in Vault (the backend refuses to boot with it in production anyway).

- [ ] **Step 14: S2 checkout, runner, token**

As `runner` on S2: create a deploy key (`~/.ssh/plantry-deploy`), add it read-only to the GitHub repo, add SSH host alias `github.com-plantry` in `~/.ssh/config` (copy the `github.com-velvet-scoop` block), then:
```bash
sudo mkdir -p /opt/plantry && sudo chown runner:runner /opt/plantry
git clone git@github.com-plantry:<owner>/plantry.git /opt/plantry
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
        proxy_pass http://192.168.40.20:3007;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```
`nginx -t && systemctl reload nginx`. In Cloudflare Zero Trust → the existing tunnel → add Public Hostname `plantry.wispy-nook.casa` → `https://localhost:443`, Origin Server Name `plantry.wispy-nook.casa`. Do **not** add a Pi-hole local DNS override for it. (Photo bytes never traverse this vhost — they go browser → MinIO hostname — so 1 MB is plenty.)

## C. First deploy + production verification

- [ ] **Step 16: Deploy**

`gh workflow run deploy.yml --repo <owner>/plantry` (or push to `main`). Watch the run; the health-check step must print `healthy`.

- [ ] **Step 17: Verify in production — every line must be checked off**

1. `https://plantry.wispy-nook.casa` → redirects to Authentik → back to the household picker. A user **not** in `plantry-users` is refused by Authentik.
2. Create a household, a store, an item with min stock; − / + work.
3. **PATCH through Cloudflare:** edit the item (this is a browser `PATCH`). If it fails with Cloudflare error 1010 (as Mealie's API does for non-browser clients), change the five `PATCH` routes + RTK endpoints to `PUT`, update the scoping-matrix `BODIES` keys, redeploy.
4. Photo: add one from a phone. If the PUT fails with a CORS or signature error, `S3_PUBLIC_ENDPOINT` is wrong (step 10). Confirm two objects in `plantry-media` via the MinIO console on S2:9003.
5. Install to home screen on a phone (on iOS this is mandatory for push), enable notifications in Settings, make an item low, force the daily job (see OPERATIONS "Force the daily job now") → one digest notification; tapping opens the shopping list.
6. Tap-to-restock on the shopping list, then Undo.
7. Invite a second real user; they join and see the same data; household switcher works with two households.
8. As a `plantry-admins` member: archive an item → "Delete permanently" is visible and works. As a non-admin: it isn't shown.
9. Settings → Feedback → submit → an issue appears in the repo with labels `feedback` + `user-submitted`; close it as completed → within the hour (or after nudging `state_fetched_at`) it shows **done**.
10. Firefox on cellular (HTTP/3 is disabled at the Cloudflare edge for this zone — confirm API calls work, since this zone has history there).
11. Next morning after 06:00 ET: `docker compose -f docker-compose.prod.yml logs backend | grep "daily stage"` shows three `done` lines, and `SELECT * FROM job_runs;` has `last_run_at` ≈ 06:00 local — confirming `TZ` + `tzdata` work.

- [ ] **Step 18: Record it in the homelab doc**

In `D:\docs\mikrotik\CLAUDE.md`: add Plantry to the S2 row of "Hardware & IPs" (frontend port 3007), to `shared-infra` databases (`plantry`), to the Cloudflare Tunnel active hostnames, to Authentik groups (`plantry-users`, `plantry-admins`), a "Plantry" gotcha block in the same style as Velvet Scoop's (repo, runner path, Vault path + key list, MinIO bucket `plantry-media` on Dinner Club's instance with a scoped service account, daily job at 06:00 ET, feedback → GitHub issues), a row in "Internal Services", and a dated "Resolved" entry. Correct the MinIO hostname there if step 10 showed it was wrong.

- [ ] **Step 19: Final commit**

```bash
git add -A && git commit -m "docs: record production deployment details"
```
