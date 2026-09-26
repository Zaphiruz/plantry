# Plantry v1 — build outcome and follow-ups

2026-09-19 · Branch `build/v1` · Plan: [2026-09-19-plantry.md](2026-09-19-plantry.md) · Spec: [../specs/2026-09-19-plantry-design.md](../specs/2026-09-19-plantry-design.md)

## State

All 27 plan tasks are implemented, each with a task-scoped review. A whole-branch review (22 findings) and a scoped re-review (4 residuals) are both closed. At head: lint 0/0, typecheck clean, **184 tests** (backend against real PostgreSQL, shared, frontend) + 1 Playwright smoke, production images build and pass their smoke checks locally.

**Deployed 2026-09-20** — plan Task 26 sections B and C were carried out with the owner approving each production step; see below.

## First deploy — done 2026-09-20 (all verified in production)

Live at https://plantry.wispy-nook.casa. Private repo `Zaphiruz/plantry`; CI on GitHub-hosted runners; Deploy on the S2 runner `S2-plantry`, triggered automatically after green CI on `main`. Docs-only commits (`**.md`, `docs/**`, `.env.example`) skip CI and therefore don't redeploy.

| Was open | Outcome |
|---|---|
| GitHub owner | `Zaphiruz/plantry`; labels `feedback` / `user-submitted` created; issues-only PAT in Vault |
| Port | **3008**, bound to `192.168.40.20` — 3007 was already taken on S2 by Aevum |
| `TRUST_PROXY_HOPS` | **3**, not 2. Chain is Cloudflare → cloudflared (LC2) → nginx (LC2) → Caddy → backend, and Caddy discards `X-Forwarded-For` unless LC2 is listed under `trusted_proxies` (now in `apps/frontend/Caddyfile`). Verified: backend logs the real client IP; a spoofed `X-Forwarded-For` is ignored |
| Browser `PATCH` through Cloudflare | Works (200). No PUT conversion needed |
| MinIO public hostname | `https://dinner-club-media.wispy-nook.casa` (the homelab doc's `media.dinner-club…` had no DNS). Presigned upload + finalize verified |
| CSP vs. presigned URLs | Fine — photo upload and display work under the deployed CSP |
| Daily job time / push | `TZ` verified in the container; job forced once → digest delivered to a phone, tap opens the shopping list |
| `deploy.yml` | Manual dispatch and the automatic `workflow_run` path both exercised; deploys the CI-validated SHA; `/api/ready` health check green |
| Secrets | Loaded by `scripts/provision-secrets.sh` (nothing displayed or stored locally); deploy key also in Vault at `deploy-keys/plantry` |

Observed, not fixed: Cloudflare's zone-wide Browser Cache TTL (4 h) rewrites `sw.js`'s `no-cache` — set it to "Respect Existing Headers" (affects every PWA on the zone). Staging secret files in /root on S2 confirmed shredded (2026-09-26).

Shipped since: per-unit step (#1), multiple barcodes per item (#3), per-item low-stock reminders toggle (#7), continuous Use/Restock scan mode (#6, #8), item groups with a shared minimum (#4).

## Deferred, by judgement (none blocks merge or first deploy)

Backend
- `DELETE /members/:sub` on yourself as the sole member returns 409 instead of deleting the household (use `/members/me`).
- `applyEvent` does one avoidable extra read; `undoEvent` doesn't clear `last_notified_at` (spec §5.1 accepts: next job re-notifies).
- No test for archived-item stock mutation → 404, the auto-deduct conditional-claim skip path, or a `getIssue` rejection in `/feedback/mine` (all implemented; unverified by test).
- `buildShoppingList` presigns thumbnails sequentially (local HMAC, not I/O).
- Photo finalize filename regex is looser than a strict UUID (no traversal possible); concurrent finalize can orphan an object (daily sweep removes it).
- Consolidate with an archived participant → 404 rather than the spec's 400 (no existence leak; arguably better).
- Push `upsert` is keyed on `endpoint` without an ownership check (needs another user's secret endpoint URL; also what makes shared browsers work).
- Feedback: 5/24 h limit is count-then-create; the GitHub issue is created before the DB row.
- SIGTERM mid-run leaves the daily-job claim set for up to 1 h (self-heals; `DELETE FROM job_runs` forces a run).
- Runtime image installs dev dependencies; images are built on the 6.7 GB production box (hence the 3-try build loop); no `mem_limit`; no Prisma `connection_limit` on the shared PostgreSQL.

Frontend
- RTK Query tags are not keyed by `hid` (spec §7) — a mutation in one household refetches the other's lists. Correctness unaffected.
- Offline mode: the household picker and invite pages aren't inside the disabled fieldset; the fieldset also disables some read-only controls; Radix dialogs escape it via portals.
- Optimistic stepper rollback can overshoot by one if a sibling mutation's refetch lands mid-flight (self-heals on the next refetch/focus).
- Add-to-list form keeps the selected store after adding (arguably a feature).
- Photo "Remove" has no confirm. `App.tsx` can flash the error panel for an instant before a 401 redirects to login.
- `Scanner.test.tsx` "no camera without a video element" passes vacuously; `logging.test.ts` has one change-detector assertion; `registerSW.ts` is untested (the PWA plugin isn't loaded under Vitest); the smoke's History assertion checks the heading, not a row.
- No `prettier --check` in CI; Playwright is not in CI.

## Bugs the reviews caught (for the record)

Concurrency: last-owner check, invite double-accept, daily-job claim, `adjust` and consolidate row locking. Data corruption: consolidate self-merge via differently-cased UUIDs. Resilience: one household's push failure aborting the whole digest; presigned image URLs never refreshing; every query failure rendering "Loading…" forever; scanner dead after one camera error; service-worker update stranding open tabs. Security: rate limiting bypassable via `X-Forwarded-For` (then via an unsigned cookie); Vault able to override `NODE_ENV`/enable the dev login; OIDC authorization codes in logs; root container; missing security headers; deploy workflow triggerable from a fork branch named `main`. UX: long-press firing while scrolling; Undo offered with nothing to undo; form edits clobbered by background refetch; double-tap restocking twice; steppers unusable by keyboard/screen reader; creating a household bouncing back to the picker (found by the Playwright smoke).
