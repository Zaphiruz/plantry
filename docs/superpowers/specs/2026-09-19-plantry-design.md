# Plantry — Design Spec

2026-09-19 · Source: `docs/Household Inventory App — Handoff Spec.md` (the "handoff spec"), adapted to the S2 homelab environment (`D:\docs\mikrotik\CLAUDE.md`).

Plantry is a self-hosted, shared household inventory PWA: track items, stock levels, minimums and store preferences; auto-deduct predictable consumption; alert on low stock; generate per-store shopping lists with one-tap restock.

This spec is the single source of truth where it differs from the handoff spec. Section 11 lists every deliberate delta.

---

## 1. Decisions locked during design

| Topic | Decision |
|---|---|
| Build scope | All v1 features in one implementation plan |
| Stack | pnpm TypeScript monorepo; Fastify 5 + Prisma backend; React/Vite/RTK Query/Tailwind/Radix PWA frontend served by Caddy (Velvet Scoop pattern) |
| Household transport | Path prefix: `/api/households/:hid/...`; frontend routes `/h/:hid/...` |
| Sessions | PostgreSQL table (no Redis anywhere in v1) |
| Shopping-list tap | Tap = restock `default_restock_qty` immediately, with undo |
| Next-trip marking | Manual "add to next trip" creates a list entry *linked* to the item |
| Auto-deduct | Amount-per-period (`qty` every `period_days`), discrete steps — supports "2/day" and "1 per 90 days" |
| Item photos | In v1. Dinner Club's MinIO instance, own bucket + scoped service account, client-side downscale, presigned PUT/GET, no worker |
| Feedback | In-app feedback files a GitHub issue (same system as Velvet Scoop / Two Cents), with per-user status tracking |
| API style | JSON is camelCase; success `{ data }`, errors `{ error: { code, message, details? } }` (matches sibling apps). Route/body names in §4 written in snake_case are illustrative — the wire format is camelCase (`sourceId`, `keepMinStockFrom`, `newCount`). |
| Timezone | Backend container `TZ=America/New_York`; daily job at 06:00 local |
| Hostname / groups | `plantry.wispy-nook.casa`; Authentik groups `plantry-users` (access gate), `plantry-admins` (hard delete) |

---

## 2. Architecture

### 2.1 Repo layout

```
apps/backend     Fastify 5, Prisma, node-cron, web-push, openid-client, @aws-sdk/client-s3
apps/frontend    React, Vite, RTK Query, Tailwind, Radix, vite-plugin-pwa (injectManifest); Caddyfile
packages/shared  zod schemas + inferred types for every request/response, enums (event types, rate windows, error codes)
```

Both apps import `packages/shared`; backend validates with the schemas, frontend types RTK Query endpoints from them.

### 2.2 Backend modules

Each is a Fastify plugin. Routes are thin; logic lives in services that take a Prisma client (so jobs and routes share code).

| Module | Purpose | Depends on |
|---|---|---|
| `auth` | OIDC login/callback/logout, session cookie, `request.user` decoration, `requireAuth`, `requireAdmin` | `sessions`, `users` tables, openid-client |
| `households` | Create/rename household, members, roles, invites, leave/remove | auth |
| `scoped` | Parent plugin at `/api/households/:hid`. One preHandler loads the caller's `household_members` row → 404 if absent → decorates `request.household = { id, role }`. **All household data routes register inside it.** | auth |
| `scoped/stores`, `units`, `items`, `inventory`, `shopping`, `rates`, `photos` | Feature routes | scoped, services |
| `services/inventory` | `applyEvent()` — the *only* writer of `inventory_events` + `inventory.current_count` (one transaction); `undoEvent()` | Prisma |
| `services/push` | web-push wrapper; deletes subscription on 404/410 | `push_subscriptions` |
| `services/storage` | Two S3 clients (internal endpoint for head/delete/list, public endpoint for presigning) | MinIO |
| `jobs/daily` | auto-deduct → low-stock push → sweeps | services |
| `push` (routes) | VAPID key, subscribe, unsubscribe (user-level, unscoped) | auth |

### 2.3 Auth

- Authentik OIDC, **confidential client**, authorization code + PKCE via `openid-client`. Scopes: `openid profile email` plus Authentik's groups scope (`goauthentik.io/providers/oauth2/scope-groups`, as in Velvet Scoop). Redirect URI `https://plantry.wispy-nook.casa/api/auth/callback` (+ `http://localhost:5173/api/auth/callback` for dev).
- PKCE/state kept in a short-lived signed cookie `plantry_oidc`.
- On callback: upsert `users` (`sub`, `name`, `email`, `last_login_at`); create `sessions` row; set cookie `plantry_sid` — HttpOnly, Secure, SameSite=Lax, 7-day sliding expiry. The cookie holds a random 256-bit id; the DB stores its SHA-256.
- Session `data` (jsonb) holds the `groups` claim and the id token (used as `id_token_hint` at logout); no tokens ever reach the browser. `isAdmin = groups.includes('plantry-admins')` — read from the session, no DB round-trip, refreshed each login.
- App access gate: bind `plantry-users` to the application in Authentik. Any authenticated user is valid to the app.
- CSRF: SameSite=Lax + every non-GET/HEAD/OPTIONS request must carry `Origin` equal to `FRONTEND_ORIGIN` (403 otherwise). Bodies are only ever parsed as JSON and validated with zod.
- Logout: delete session row, clear cookie, redirect to Authentik end-session endpoint.

### 2.4 Deployment (S2, per "Adding a new app" checklist)

- `/opt/plantry/docker-compose.prod.yml`: `backend` (no host port; networks `shared-db`; mounts Cloudflare Origin CA, `NODE_EXTRA_CA_CERTS`; `TZ=America/New_York`) and `frontend` (Caddy, `3007:80`, proxies `/api/*` → `backend:3000`). `restart: unless-stopped`.
- PostgreSQL: user `plantry`, database `plantry` created with `TEMPLATE template0` (collation-mismatch gotcha).
- Vault: policy `plantry`, periodic token via `add-app-token.sh`, `.env` holds only `VAULT_ADDR` + `VAULT_TOKEN`; `entrypoint.mjs` fetches `secret/data/plantry`:
  `DATABASE_URL`, `SESSION_SECRET`, `FRONTEND_ORIGIN`, `AUTHENTIK_ISSUER_URL`, `AUTHENTIK_CLIENT_ID`, `AUTHENTIK_CLIENT_SECRET`, `AUTHENTIK_REDIRECT_URI`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `GITHUB_FEEDBACK_TOKEN`, `GITHUB_FEEDBACK_REPO`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`.
- nginx server block on LC2 (`proxy_pass http://192.168.40.20:3007`, `X-Forwarded-Proto https`), Cloudflare Tunnel public hostname `plantry.wispy-nook.casa`. Fastify `trustProxy: true`.
- GitHub repo **private**; self-hosted runner `/opt/actions-runner-plantry` as `runner`; deploy key + SSH host alias `github.com-plantry`. Deploy workflow runs only after CI passes on `main`: pull → `docker compose build` → `prisma migrate deploy` (one-off `compose run`, `DATABASE_URL` injected from Vault via the python3 one-liner pattern) → `up -d` → health check.
- **PATCH check**: Mealie's external API returns Cloudflare 1010 on PATCH/PUT from non-browser clients. Verify a browser-originated `PATCH /items/:id` passes the tunnel during first deploy; if blocked, switch item/store/unit/member updates to `PUT`.
- Local dev: `docker-compose.yml` with postgres + minio + minio-setup (bucket create); `AUTH_DEV_BYPASS=1` stub user for non-production only (refuses to start if `NODE_ENV=production`).

---

## 3. Data model

UUID PKs unless noted. All quantities `numeric(12,3)`. All `*_sub` / `*_by` columns FK → `users.sub`.

**users** — `sub` (PK, text), `name`, `email`, `last_login_at`, `created_at`

**sessions** — `id_hash` (PK), `user_sub`, `data` jsonb, `expires_at`, `created_at`

**households** — `id`, `name`, `created_at`

**household_members** — `household_id`, `user_sub`, `role` (`owner`|`member`), `joined_at`. PK `(household_id, user_sub)`.

**household_invites** — `id`, `token_hash` (unique), `household_id`, `created_by`, `expires_at` (created + 7 days), `accepted_by` (null), `accepted_at` (null). Single-use, grants `member`.

**stores** — `id`, `household_id`, `name`, `notes` (null)

**units** — `id`, `name`, `plural_name` (null), `abbreviation` (null), `household_id` (null = global). Seeded globals: each, oz, lb, g, kg, ml, l, can, bottle, box, bag, roll, gallon.

**items** — `id`, `household_id`, `name`, `description` (null), `category` (null), `unit_id`, `preferred_store_id` (**nullable**), `barcode` (null), `image_ref` (null — S3 key of full image; thumb key is derived), `renotify_after_days` (int, default 7), `default_restock_qty` (default 1, > 0), `auto_deduct_qty` (null, > 0), `auto_deduct_period_days` (int, default 1, ≥ 1), `auto_deduct_paused` (bool, default false), `archived_at` (null), `archived_by` (null), `created_at`, `updated_at`.
Index: unique `(household_id, barcode) WHERE barcode IS NOT NULL AND archived_at IS NULL`.

**inventory** (1:1) — `item_id` (PK/FK, cascade), `current_count` (may go negative), `min_stock`, `last_restocked_at`, `last_checked_off_at`, `last_auto_deduct_at` (the auto-deduct anchor), `last_notified_at` (all nullable timestamps)

**inventory_events** — `id`, `item_id` (FK, cascade), `household_id`, `event_type` (`restock`|`consume`|`adjust`|`auto_deduct`), `quantity`, `note` (null), `user_sub` (null for system), `created_at`.
Sign convention: `quantity > 0` for restock/consume/auto_deduct (direction implied by type); `adjust` stores a **signed delta**. Invariant: `current_count = Σ restock − Σ consume − Σ auto_deduct + Σ adjust`. Index `(item_id, created_at)`.

**item_merges** — `source_id`, `target_id`, `merged_by`, `merged_at`

**shopping_list_items** — `id`, `household_id`, `item_id` (**null = free-text**), `name`, `store_id` (null), `quantity` (null), `added_by`, `checked_off` (bool), `checked_off_at` (null), `created_at`.
Index: unique `(household_id, item_id) WHERE item_id IS NOT NULL AND NOT checked_off`.

**push_subscriptions** — `endpoint` (PK), `user_sub`, `p256dh`, `auth`, `created_at`

**job_runs** — `job` (PK), `last_run_at`, `started_at` (non-null while a run holds the claim)

**feedback_submissions** — `id`, `user_sub`, `issue_number`, `issue_url`, `title`, `state` (null), `state_reason` (null), `closed_at` (null), `state_fetched_at` (null), `created_at`

---

## 4. API

Base `/api`. Error envelope: `{ error: { code, message, details? } }`. Any id belonging to another household → **404** (no existence leak). Non-member on `:hid` → 404.

```
# auth (unscoped)
GET    /auth/login
GET    /auth/callback
POST   /auth/logout
GET    /me                                   # user, isAdmin, households[{id,name,role}]

# push (unscoped, user-level)
GET    /push/vapid-key
POST   /push/subscriptions                   { endpoint, keys }     # upsert
DELETE /push/subscriptions                   { endpoint }

# feedback (unscoped, user-level; routes absent when GitHub isn't configured)
POST   /feedback                             { body, pageUrl? }     # 201 → { issueNumber, issueUrl }; 429 rate_limited after 5 / 24 h
GET    /feedback/mine                                               # my submissions with status open | done | closed

# households (unscoped)
POST   /households                           { name }               # caller becomes owner
POST   /invites/:token/accept                                       # 410 if expired/used; idempotent if already member

# everything below is under /households/:hid
PATCH  /                                     { name }               # owner
GET    /members
PATCH  /members/:sub                         { role }               # owner; cannot demote last owner (409 last_owner)
DELETE /members/me                                                  # 409 last_owner if last owner and others remain; deletes household if last member
DELETE /members/:sub                                                # owner
POST   /invites                                                     # any member → { url, expires_at }

GET    /stores          POST /stores         PATCH /stores/:id      DELETE /stores/:id   # delete nulls references
GET    /units           POST /units          PATCH /units/:id       DELETE /units/:id    # globals read-only; 409 unit_in_use {item_count}

GET    /items                                ?q= &barcode= &archived=true
POST   /items                                                       # also creates inventory row { current_count, min_stock }
GET    /items/:id                                                   # includes inventory, image urls
PATCH  /items/:id                                                   # item fields + min_stock
POST   /items/:id/archive
POST   /items/:id/unarchive                                         # 409 if barcode now collides
DELETE /items/:id                                                   # requireAdmin; 400 archive_first
POST   /items/:target_id/consolidate         { source_id, keep_min_stock_from?: 'target'|'source' }
POST   /items/:id/photo/upload-url           { mimeType, sizeBytes, thumbSizeBytes }
POST   /items/:id/photo/finalize             { key }
DELETE /items/:id/photo

GET    /inventory                                                   # non-archived items + inventory + image thumb urls
GET    /inventory/low
POST   /inventory/:itemId/restock            { quantity, note? }    # quantity > 0
POST   /inventory/:itemId/consume            { quantity?, note? }   # default 1
POST   /inventory/:itemId/adjust             { new_count, note? }   # server computes delta
GET    /inventory/:itemId/events             ?cursor=
DELETE /inventory/events/:eventId                                   # undo: own event, < 5 min old, not auto_deduct

GET    /items/:id/consumption-rate           ?window=30d|60d|90d|183d|365d
GET    /items/consumption-rates              ?window=...

GET    /shopping-list                                               # merged, grouped by store (see 5.5)
POST   /shopping-list/items/:itemId/purchase { quantity? }          # → { event_id }
POST   /shopping-list-items                  { item_id, quantity? } | { name, store_id?, quantity? }
PATCH  /shopping-list-items/:id              { checked_off }        # free-text rows only
DELETE /shopping-list-items/:id
```

---

## 5. Core behaviors

### 5.1 applyEvent
Single transaction: insert event → update `current_count` → side effects:
- `restock`: set `last_restocked_at`.
- any event leaving `current_count > min_stock`: clear `last_notified_at`.
`undoEvent` deletes the event and reverses the count in one transaction. It does not roll back `last_restocked_at` / `last_checked_off_at` (informational only) or restore a cleared `last_notified_at` — if the item is low again after the undo, the next daily job simply re-notifies.

### 5.2 Auto-deduct (amount per period, discrete)
```
for each non-archived item with auto_deduct_qty not null and not paused:
    anchor  = inventory.last_auto_deduct_at           # always set when auto-deduct is enabled
    periods = floor((now - anchor) / period_days)
    if periods >= 1:
        applyEvent(auto_deduct, quantity = qty * periods, user_sub = null)
        last_auto_deduct_at = anchor + periods * period_days     # NOT now()
```
- Advancing by whole periods carries the remainder: missed runs catch up exactly, no drift, idempotent.
- Anchor resets to `now()` when auto-deduct is enabled, its qty/period is edited, or it is un-paused (no back-charge for paused time). Restocking does **not** reset it.
- Each item runs in its own transaction; one failure doesn't stop the run.
- Examples: cat food `qty=2, period=1`; water filter `qty=1, period=90`. UI: "Uses [qty] every [n] days".

### 5.3 Consumption rate
Derived, never stored. `SUM(quantity) / days` over `consume` + `auto_deduct` events in the window; `days = min(window_days, now − first_event_at)`, floor 1 day. Window is the fixed enum; anything else → 400. UI defaults the window to the smallest enum value ≥ 2 × `auto_deduct_period_days` (else 30d).

### 5.4 Low-stock alerting
- Pull: `current_count <= min_stock` on non-archived items → badge + `/inventory/low`.
- Push (daily job, after auto-deduct): eligible = low AND (`last_notified_at IS NULL OR now − last_notified_at >= renotify_after_days`). Group per household → **one digest notification per member device**: "Casa: 3 items low — cat food, filters, +1"; click opens `/h/:hid/shopping`. Then set `last_notified_at` on those items. Sent synchronously; 404/410 → delete subscription; other errors logged.

### 5.5 Shopping list
`GET /shopping-list` returns entries grouped by store ("Any store" last), merged from:
1. **Derived** — non-archived items with `current_count <= min_stock`.
2. **Linked manual** — `shopping_list_items` with `item_id` (the "add to next trip" action). Deduped with (1) by `item_id`: one entry, flagged `low: true` and/or `manual: true`; store comes from the item.
3. **Free-text** — `item_id` null; store from the row.

**Purchase** (tap on an item-backed entry): `applyEvent(restock, quantity ?? row.quantity ?? default_restock_qty)`, set `last_checked_off_at`, delete any linked manual row; return `event_id`. Frontend shows an undo toast (→ `DELETE /inventory/events/:id`; the manual row is not resurrected — acceptable). Long-press edits quantity before purchasing. If a derived item is still ≤ min after purchase it remains on the list (correct: buy more).

**Free-text** tap toggles `checked_off`; checked rows show struck-through and are swept after 24 h.

### 5.6 Item lifecycle
- **Archive** (member): sets `archived_at/by`; drops from default lists, shopping list, rates, auto-deduct, alerts. Deletes its linked manual list rows.
- **Hard delete** (admin): archived only; cascades inventory + events; deletes photo objects.
- **Consolidate** (member, atomic): re-point source's events to target; `target.current_count += source.current_count`; `min_stock` per `keep_min_stock_from` (default target); re-point source's linked list rows (drop if target already has one); move barcode to target if target has none, then clear source's barcode; target inherits source photo if it has none; archive source; insert `item_merges`. 400 if source = target, either archived, or different households (404).

### 5.7 Units
Lookup `household_id = :hid OR household_id IS NULL`. Delete blocked (409 `unit_in_use`, `details.item_count`) while referenced by any non-archived item. If only archived items reference it, the delete proceeds and those archived items are re-pointed to the global "each" unit in the same transaction.

### 5.8 Household rules
Last owner leaving while others remain → 409 `last_owner`. Last member leaving → household deleted (cascade everything, including photo objects). Owner can promote/demote/remove; cannot demote self if last owner.

### 5.9 Item photos
Infrastructure: Dinner Club's MinIO (`dinner-club-minio-1`, `192.168.40.20:9002`), following the documented one-instance/bucket-per-app model. New private bucket `plantry-media` + scoped service account (policy limited to that bucket). `S3_ENDPOINT=http://192.168.40.20:9002`; `S3_PUBLIC_ENDPOINT` = the existing public MinIO hostname (presigned URLs must be signed against it). **Verify at deploy** which hostname is live — homelab docs say `media.dinner-club.wispy-nook.casa`, Dinner Club's prod compose says `dinner-club-media.wispy-nook.casa`.

Flow (no worker, no sharp):
1. Browser downsizes via canvas: full (max 1600 px long edge) + thumb (256 px), both JPEG q≈0.82 (this also strips EXIF/GPS).
2. `POST /photo/upload-url` validates `mimeType = image/jpeg`, `sizeBytes ≤ 5 MB`, `thumbSizeBytes ≤ 200 KB`; returns two presigned PUTs (15 min, `ContentType` + `ContentLength` pinned) for keys `h/{hid}/items/{itemId}/{uuid}.jpg` and `…/{uuid}-thumb.jpg`.
3. Browser PUTs both, then `POST /photo/finalize { key }`: backend validates the key prefix belongs to this item, HEADs both objects, sets `items.image_ref = key`, deletes the previous pair.
4. Reads: item/inventory/shopping-list responses include `image_url` / `thumb_url` — presigned GETs (1 h TTL, signing is local CPU only) plus `image_urls_expire_at`; RTK Query refetches on expiry/focus.
5. Daily sweep deletes objects under `h/` older than 24 h not referenced by any `image_ref` (abandoned uploads).

Photos are optional end-to-end: if `S3_*` secrets are absent the upload endpoints return 503 `photos_disabled` and the UI hides the control.

### 5.10 Barcode scanning
`BarcodeDetector` where available, else `@zxing/browser`. Scan → `GET /items?barcode=X` → match: action sheet (Restock default / Consume 1 / Open); no match: new-item form with barcode prefilled.

### 5.11 Feedback → GitHub issues
Same system as Velvet Scoop / Two Cents. `POST /feedback` creates an issue in the Plantry repo (title = first 57 chars + "…", body = text + submitter name/sub + page path, labels `feedback` + `user-submitted`) using a fine-grained PAT with Issues read/write only (`GITHUB_FEEDBACK_TOKEN`, `GITHUB_FEEDBACK_REPO=owner/repo` in Vault), and records a `feedback_submissions` row. Limit 5 per user per 24 h (429 `rate_limited`). `GET /feedback/mine` derives status from cached GitHub state: not closed → `open`; closed as completed → `done`; otherwise `closed`. Closed state is cached forever; non-closed issues are re-fetched when the cache is > 1 h old (an improvement over Velvet Scoop, which never refreshes). GitHub failures on refresh are logged and the cached status is shown. If the env vars are absent the routes don't exist, `/me.feedbackEnabled` is false and the UI hides the form. UI lives in Settings: textarea + "my submissions" list with status chips.

---

## 6. Daily job

`node-cron` `0 6 * * *` (container TZ). On boot, run immediately if `job_runs.last_run_at` is > 24 h old. Overlapping starts are prevented by an atomic claim on the `job_runs` row (`started_at`; a claim older than 1 h is considered stale and can be taken over) — not a session advisory lock, which is unsafe with Prisma's connection pool. Order: (1) auto-deduct, (2) low-stock push, (3) sweeps — expired sessions, expired/used invites > 30 d, checked-off free-text rows > 24 h, orphan photo objects. Each stage is try/caught and logged independently; then update `job_runs`.

---

## 7. Frontend

Mobile-first PWA. Routes:

| Route | Screen |
|---|---|
| `/` | Household picker (or create / paste invite if none). Never auto-selects. |
| `/invite/:token` | Accept invite → redirect to that household |
| `/h/:hid` | **Inventory**: search, category filter, low badge, thumb, −/+ steppers (consume/restock 1), long-press for quantity, 🛒 toggle per row → add to / remove from next trip (a visible button rather than a swipe: discoverable, accessible, no conflict with scrolling), scan button |
| `/h/:hid/items/new`, `/h/:hid/items/:id` | **Item detail/edit**: fields, photo, "Uses X every Y days" + pause, re-notify cadence, default restock qty, rate + window picker, event history, add to next trip (toggles to "On next trip ✓"), archive, merge into…, delete (admin + archived only) |
| `/h/:hid/shopping` | **Shopping list**: grouped by store, tap = purchase + undo toast, long-press = quantity, free-text add box with optional store, checkbox rows for free-text |
| `/h/:hid/settings` | Members/roles/invite link/leave, stores, units, archived items, notifications (subscribe toggle; iOS "install to home screen" hint) |

Persistent header: household switcher (changes the `:hid` URL segment), low-stock count badge on the Shopping tab. RTK Query tags keyed by `hid`. 401 from any call → redirect to `/api/auth/login`.

Service worker (`src/sw.ts`): Workbox precache of the shell, `push` handler (shows digest), `notificationclick` (focus/open the URL in the payload). **No offline mutation queue** — offline shows a banner and disables mutating controls.

---

## 8. Error handling

- zod validation failure → 400 `validation_error` with field details.
- Named codes: `archive_first` (400), `last_owner` (409), `unit_in_use` (409), `barcode_conflict` (409), `already_on_list` (409), `undo_expired` (409), `invite_invalid` (410), `rate_limited` (429), `photos_disabled` (503), `forbidden` (403 — role/admin failures *within* a household the caller belongs to), `not_found` (404).
- Prisma unique violations are mapped to the codes above, never leaked raw.
- Fastify error handler logs 5xx with request id; responses never include stack traces.
- Frontend: RTK Query middleware turns error codes into toasts; optimistic stepper updates roll back on failure.

---

## 9. Testing

**Backend** — Vitest against real PostgreSQL (compose locally, service container in CI); each test file gets a fresh schema. Priority suites:
- `applyEvent`/`undoEvent`: count == event-sum invariant; `last_notified_at` clearing; 5-minute/own-event undo rules.
- Auto-deduct: multi-period catch-up, remainder carry (run at 1.5 periods, then 2.1), 90-day period, pause/un-pause anchor reset, edit resets anchor, restock doesn't.
- Rates: enum rejection, young-item divisor, excludes restock/adjust.
- Consolidate: atomicity (forced failure mid-way leaves nothing changed), barcode/photo/list-row inheritance.
- **Scoping matrix**: every scoped route × (non-member, foreign-household resource id) → 404. Generated from the route table so new routes can't skip it.
- Household rules: last owner, last member delete, role changes. Invites: expiry, single use, already-member.
- Shopping list merge/dedupe; purchase removes manual row; still-low item stays.
- Low-stock digest: cadence logic, grouping, 410 cleanup (web-push mocked).
- Photos: key-prefix validation, finalize HEAD failure, old-object deletion (S3 client mocked; one integration test against dev MinIO).
- OIDC stubbed at the `openid-client` boundary; session cookie/CSRF origin check tested for real.

**Shared** — schema tests. **Frontend** — Vitest + Testing Library for list grouping, steppers + rollback, undo toast, image downscale util. One Playwright smoke (dev-bypass auth): create item → consume → appears on list → purchase → gone.

**CI** — lint + typecheck + tests on every push; deploy job only on `main`, after tests.

---

## 10. Out of scope (v1)

Unit conversion; Redis/queues; offline writes; email notifications; multiple photos per item; server-side image processing; per-user notification preferences beyond subscribe/unsubscribe.

---

## 11. Deltas from the handoff spec

1. New tables: `users`, `sessions`, `household_invites`, `job_runs`.
2. `items.auto_deduct_per_day` → `auto_deduct_qty` + `auto_deduct_period_days`; discrete whole-period deduction with remainder-carrying anchor.
3. `items.default_restock_qty` added; shopping-list tap restocks immediately with undo.
4. `shopping_list_items.item_id` / `quantity` / `checked_off_at` added; "add to next trip" is item-linked and deduped with derived entries.
5. `items.preferred_store_id` nullable; barcode unique per household among active items.
6. `inventory_events.note` added; sign convention fixed; `adjust` endpoint, event history endpoint, and undo endpoint added.
7. Household-scoped routes moved under `/households/:hid`; added members list/role change, household rename, store/unit PATCH/DELETE, unarchive, push subscription routes.
8. Low-stock push is a per-household digest, not per item.
9. Item photos implemented (handoff left `image_ref` as a placeholder).
10. `push_subscriptions` keyed by `endpoint`.
11. GitHub-issue feedback system added (`feedback_submissions`, `/feedback` routes).
12. Wire format is camelCase with a `{ data }` success envelope, matching the sibling apps.
