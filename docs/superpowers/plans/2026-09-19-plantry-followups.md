# Plantry v1 — build outcome and follow-ups

2026-09-19 · Branch `build/v1` · Plan: [2026-09-19-plantry.md](2026-09-19-plantry.md) · Spec: [../specs/2026-09-19-plantry-design.md](../specs/2026-09-19-plantry-design.md)

## State

All 27 plan tasks are implemented, each with a task-scoped review. A whole-branch review (22 findings) and a scoped re-review (4 residuals) are both closed. At head: lint 0/0, typecheck clean, **184 tests** (backend against real PostgreSQL, shared, frontend) + 1 Playwright smoke, production images build and pass their smoke checks locally.

**Not done — needs the owner:** plan Task 26 sections B (provision) and C (first deploy + production verification). The runbook is `OPERATIONS.md`. Nothing has touched S2, LC2, LC3, Authentik, Vault, Cloudflare, MinIO or GitHub.

## Must be settled at first deploy (cannot be verified off-box)

1. ~~GitHub owner~~ — done: private repo `Zaphiruz/plantry` (`GITHUB_FEEDBACK_REPO=Zaphiruz/plantry`). CI is green there. The **Deploy workflow is disabled** until the S2 runner exists — re-enable per `OPERATIONS.md` step 16. Still to do on GitHub: create the `feedback` / `user-submitted` labels and the issues-only fine-grained PAT (step 8).
2. **`TRUST_PROXY_HOPS=3`** in Vault (measured at first deploy: cloudflared → nginx on LC2 → Caddy, and Caddy must list LC2 under `trusted_proxies` or it discards X-Forwarded-For entirely). With the default `0`, `req.ip` is the Caddy container address, so every user shares one rate-limit bucket. If the chain ever changes, this number must change with it.
3. **Browser `PATCH` through the Cloudflare Tunnel** (Mealie's API gets error 1010 for non-browser PATCH/PUT). If blocked: switch the item/store/unit/member/household/shopping-row updates to `PUT` on both sides and update the scoping-matrix `BODIES` keys.
4. **MinIO public hostname** — homelab doc says `media.dinner-club.wispy-nook.casa`, Dinner Club's prod compose says `dinner-club-media.wispy-nook.casa`. Whichever is live becomes `S3_PUBLIC_ENDPOINT`; fix the wrong document. A CORS/signature error on photo upload means this value is wrong.
5. **CSP vs. reality** — the Caddy CSP allows `connect-src/img-src https:` for presigned MinIO URLs. Watch the browser console on first photo upload and first scan.
6. **Daily job time** — next morning, confirm `job_runs.last_run_at` ≈ 06:00 America/New_York (proves `TZ` + `tzdata`).
7. **`deploy.yml`** was reviewed against the `workflow_run` payload schema but never executed. First run: confirm it checks out the CI-validated SHA and the `/api/ready` health check goes green.

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
