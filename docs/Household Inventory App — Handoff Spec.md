# Household Inventory App — Handoff Spec

2026-09-19 · @Someone

## Overview & Stack

A self-hosted, shared household inventory web app: track items, per-item stock levels, minimums, and store preferences; auto-generate low-stock alerts and per-store shopping lists.

**Stack**

- **Frontend**: React SPA (matches other apps in the deployment)
- **Backend**: Node (Express/Fastify) — pick whichever the other apps already standardize on
- **DB**: PostgreSQL
- **Cache/queue**: Redis available but deferred — not needed for v1 (no sessions-at-scale, no async job volume). Revisit if web push volume grows or async job queuing becomes worthwhile.
- **Auth**: OIDC against a local Authentik instance. App access is gated entirely by Authentik (login = valid user); no separate app-level signup/invite layer.
- **Session**: cookie-based, HttpOnly. Backend handles the OIDC code exchange and holds tokens server-side; browser only gets a session cookie. Keeps tokens off the client.
- **Deploy**: Docker Compose, alongside other self-hosted apps, behind the same reverse proxy pattern.

## Architecture: Households & Access

**Two separate access layers:**

- **App access** — gated entirely by Authentik. If you can log in, you're a valid user. No app-level invite/signup flow.
- **Household access** — controls which household's data you see. Invite-based, app-owned (not modeled in Authentik).

**Membership is many-to-many.** A user can belong to multiple households (e.g. helping manage a parent's place too). No auto-selected "active" household is remembered across sessions — the frontend always shows an explicit household switcher (persistent header selector), and every API call carries the selected `household_id` explicitly (header or path param — pick one convention and apply it to every endpoint). Backend always re-validates that the authenticated user is actually a member of the claimed `household_id` — never trust the client-supplied value alone.

**Leaving / removal**

- A member can leave voluntarily (`DELETE /households/{id}/members/me`).
- An owner can remove another member (`DELETE /households/{id}/members/{user_sub}`).
- If the last owner tries to leave a household that still has members: block it ("assign another owner first") rather than auto-promoting someone.
- If a household's last member leaves: delete the household.

**App-wide admin** (hard-delete of archived items) comes from an Authentik `groups` claim (e.g. `household-inventory-admin`), checked directly off the token — this is separate from the household-level `owner`/`member` role, and needs no DB round-trip.

## Data Model

**households** — `id`, `name`, `created_at`

**household\_members** — `household_id` (FK), `user_sub`, `role` (`owner`/`member`), `joined_at`. PK on `(household_id, user_sub)`; no uniqueness on `user_sub` alone (many-to-many).

**stores** — `id`, `household_id` (FK), `name`, `notes` (nullable)

**units** — `id`, `name`, `plural_name` (nullable), `abbreviation` (nullable), `household_id` (FK, nullable — null means global default)

**items** (the catalog) — `id`, `household_id` (FK), `name`, `description` (nullable), `category` (nullable), `unit_id` (FK), `preferred_store_id` (FK), `barcode` (nullable), `image_ref` (nullable, placeholder for shared media DB integration — details TBD), `renotify_after_days` (integer, default 7), `archived_at` (nullable), `archived_by` (nullable, user\_sub), `created_at`, `updated_at`

**inventory** (1:1 with items) — `item_id` (PK/FK), `current_count` (numeric, can go negative), `min_stock` (numeric), `last_restocked_at` (nullable), `last_checked_off_at` (nullable), `last_auto_deduct_at` (nullable), `last_notified_at` (nullable, cleared when restocked above min\_stock)

**inventory\_events** (audit trail / source of truth for consumption history) — `id`, `item_id` (FK), `household_id` (FK, denormalized), `event_type` (`restock` / `consume` / `adjust` / `auto_deduct`), `quantity`, `user_sub` (nullable — null for system-generated `auto_deduct` events), `created_at`

**item\_merges** (audit trail for consolidation) — `source_id`, `target_id`, `merged_by`, `merged_at`

**shopping\_list\_items** (ad-hoc, non-inventory-derived entries) — `id`, `household_id` (FK), `name`, `store_id` (nullable FK), `added_by`, `checked_off`, `created_at`

**push\_subscriptions** — `user_sub`, `endpoint`, `p256dh`, `auth`, `created_at`. A user can have multiple (multiple devices/browsers).

## Core Behaviors

**Restock / consume** — each action inserts an `inventory_events` row and updates `inventory.current_count` (derived cache, `inventory_events` is the source of truth). Consume can decrement by 1 or a specified quantity.

**Auto-deduct** (e.g. cat food cans/day) — `items.auto_deduct_per_day` (nullable) and `items.auto_deduct_paused` (boolean). A daily job (in-process scheduler, e.g. APScheduler/node-cron, in the same container — no separate cron container or Redis needed):

```
for each item where auto_deduct_per_day is not null and not paused:
    days_elapsed = now - inventory.last_auto_deduct_at (or item.created_at if never run)
    deduct_amount = auto_deduct_per_day * days_elapsed
    insert inventory_events (event_type='auto_deduct', quantity=deduct_amount, user_sub=null)
    update inventory.current_count -= deduct_amount
    update inventory.last_auto_deduct_at = now
```

Using elapsed time (not assuming exactly one day) keeps this idempotent if the job misses a run. `current_count` is allowed to go negative — that's a useful signal ("out for N days") and `current_count <= min_stock` already catches it as low-stock with no extra logic.

**Consumption rate** — derived query, not a stored column (rates drift, a stale cached number is worse than none):

```sql
SELECT item_id, SUM(quantity) / <days_in_window> AS avg_per_day
FROM inventory_events
WHERE event_type IN ('consume', 'auto_deduct')
  AND created_at >= now() - interval '<window>'
GROUP BY item_id
```

Only `consume` and `auto_deduct` count as usage; `restock`/`adjust` are excluded. Window is a **fixed enum**: `30d`, `60d`, `90d`, `183d`, `365d` — reject any other value (400). For items younger than the selected window, divide by `min(window_days, now - first_event_at)` rather than the full window, so the rate isn't artificially diluted for new items.

**Low-stock alerting** — both pull (in-app list/badge, `current_count <= min_stock`) and push (web notifications):

- Web Push API (VAPID keys); subscriptions stored in `push_subscriptions`.
- The daily job checks low-stock status per item after auto-deduct runs, and pushes to household members' subscriptions if `last_notified_at IS NULL OR now() - last_notified_at >= items.renotify_after_days`.
- `renotify_after_days` (integer, default 7) is per-item and user-editable — lets something urgent (cat food) re-notify daily while something low-priority (paper towels) waits 2 weeks.
- On restock above `min_stock`, clear `inventory.last_notified_at` to null so the next low-stock dip notifies immediately rather than waiting out a stale cadence.

## Item Lifecycle

**Archive** (any household member) — sets `archived_at`/`archived_by`; item drops out of default list/shopping-list/consumption queries, but `inventory` and `inventory_events` rows stay intact.

**Hard delete** (admin only, via Authentik group — see Architecture) — only allowed on already-archived items (400 otherwise, "archive first"). Cascades to `inventory` and `inventory_events` for that item. Genuinely destructive, no fallback once triggered.

**Consolidation flow** (any household member — non-destructive) — `POST /items/{target_id}/consolidate { source_id, keep_min_stock_from?: 'target' | 'source' }`, atomic:

1. Reassign all `inventory_events` rows from `source_id` to `target_id`, preserving full consumption history under the surviving item.
2. Merge `inventory` state: `target.current_count += source.current_count`. `min_stock` defaults to the target's value unless overridden.
3. Archive the source item (not deleted — recoverable if the merge was a mistake).
4. Record the merge in `item_merges` for auditability.

## Units (Mealie-style)

Units are first-class, reusable entities rather than free text on items (`units` table above). `household_id` nullable on `units` allows a shared **global default set** (count/each, oz, lb, g, kg, ml, l, can, bottle, box, bag, roll, gallon — seed via migration) plus per-household custom units. Lookup: `WHERE household_id = ? OR household_id IS NULL`.

`items.unit_id` replaces a free-text unit field.

**Deletion guard**: block deleting a unit still referenced by any non-archived item; return 409 with a count of affected items so the UI can surface it.

Unit *conversion* (e.g. case of 12 ↔ can) is out of scope for v1 — this design doesn't block adding a `unit_conversions` table later if it becomes worth it.

## Shopping Lists

Two sources, merged in one view, grouped by store:

1. **Derived**: items where `current_count <= min_stock`.
2. **Ad-hoc**: `shopping_list_items` rows — for things not tracked as inventory at all ("birthday candles") or a one-off variant of a tracked item ("the good coffee, not our usual"). An "add to next list" button on an item's detail view inserts here too, decoupled from actual stock state.

Checking off an ad-hoc entry just deletes/flags the row (`checked_off`); it doesn't touch `inventory`.

## Additional Features

**Barcode scanning** (phone camera) — uses the existing `items.barcode` field. Restock/consume flows get a scan mode: native `BarcodeDetector` API where supported, fallback to a JS lib (`quagga2` or `zxing-js`) for broader browser coverage. Scanned code looked up via `GET /items?barcode=X`; match → jump to that item's restock/consume action; no match → offer to create a new item with the barcode pre-filled. Frontend-only addition beyond the lookup endpoint.

**Item photos** — `items.image_ref` reserved as a placeholder pointing at the shared media DB. Left unintegrated until details are available — no other schema impact in the meantime.

## API Surface Summary

```
# households / membership
GET    /me                              # households the user belongs to, role in each
POST   /households
POST   /households/{id}/invites
POST   /invites/{token}/accept
DELETE /households/{id}/members/me
DELETE /households/{id}/members/{user_sub}

# stores / units
GET    /stores
POST   /stores
GET    /units
POST   /units
DELETE /units/{id}

# items
GET    /items
GET    /items?barcode=X
POST   /items
GET    /items/{id}
PATCH  /items/{id}
POST   /items/{id}/archive
DELETE /items/{id}                      # admin only, archived items only
POST   /items/{target_id}/consolidate   { source_id, keep_min_stock_from? }

# inventory
GET    /inventory
GET    /inventory/low
POST   /inventory/{item_id}/restock     { quantity }
POST   /inventory/{item_id}/consume     { quantity }
GET    /items/{id}/consumption-rate?window=30d|60d|90d|183d|365d
GET    /items/consumption-rates?window=...

# shopping lists
GET    /shopping-lists                  # derived low-stock + shopping_list_items, grouped by store
POST   /shopping-list-items             { name, store_id? }
DELETE /shopping-list-items/{id}
```

Every endpoint above (except `/me`, invite accept, and household creation) is implicitly scoped to the caller's selected `household_id`, validated server-side on every request.

## Open Decisions

- **ORM/query builder** — stay consistent with whatever the other apps in the stack already use (Prisma, Drizzle, Knex, etc.)
- **Household\_id transport convention** — header (`X-Household-Id`) vs. path param (`/households/{id}/...`); pick one before building, since it touches every endpoint.
- **Web push retry/queuing** — fine to send synchronously from the daily job at this scale; revisit with Redis if volume grows.
- **Seed data** — confirm the starter global units list before first migration.
