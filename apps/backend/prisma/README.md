# Prisma migrations — read before running `prisma migrate dev`

Two **partial unique indexes** are hand-written and equally invisible to
`schema.prisma` (it cannot express a `WHERE` clause on a unique index):

| index | table | meaning |
| --- | --- | --- |
| `item_barcodes_household_code_active_key` | `item_barcodes (household_id, code) WHERE NOT archived` | a barcode identifies at most one *live* item per household; archived items may reuse it. Written in `migrations/20260924132240_item_barcodes/migration.sql`, replacing the retired `items_household_barcode_active_key` (dropped in that same migration, when `items.barcode` moved to the `item_barcodes` table). |
| `sli_household_item_open_key` | `shopping_list_items (household_id, item_id) WHERE item_id IS NOT NULL AND NOT checked_off` | an item appears at most once as an *open* shopping-list line; checked-off history is unconstrained. Written in `migrations/20260919205143_init/migration.sql`. |

The init migration also carries `CHECK` constraints (`items_default_restock_qty_pos`,
`items_auto_deduct_qty_pos`, `items_auto_deduct_period_pos`) and the seed rows
for the 13 global units, all equally invisible to `schema.prisma`.

## Why this matters

`prisma migrate dev` diffs the *database* against `schema.prisma` and writes SQL
to make the database match. Because the schema has no record of these indexes,
Prisma sees them as drift and will happily emit a `DROP INDEX` for one of them
into your new migration. Applying that silently removes the uniqueness
guarantee the application relies on — duplicate barcodes and duplicate open
shopping-list lines become possible, with no error anywhere.

## The workflow

Always create migrations **`--create-only`**, then read the generated SQL before
applying it:

```bash
corepack pnpm --filter @plantry/backend prisma migrate dev --create-only --name your_change
# 1. open prisma/migrations/<timestamp>_your_change/migration.sql
# 2. delete any DROP INDEX / DROP CONSTRAINT line touching the objects above
#    (unless you are deliberately replacing one — see below)
# 3. apply it
corepack pnpm --filter @plantry/backend prisma migrate dev
# 4. refresh the test database
corepack pnpm --filter @plantry/backend test:db:setup
```

If your change legitimately replaces one of these indexes, update it with explicit
`DROP INDEX` + `CREATE UNIQUE INDEX … WHERE …` SQL **and** update the guard
(`src/migrations.test.ts`) — see how the multi-barcode migration allow-lists its
own directory for the one legitimate drop of `items_household_barcode_active_key`.

## The guard

`src/migrations.test.ts` fails the backend suite if either current index is
missing from the live test database, or if any `migrations/*/migration.sql`
contains a `DROP INDEX` for a currently-protected name. It also asserts that the
retired `items_household_barcode_active_key` is dropped by nothing except the
migration directory that replaced it. Keep the lists in that test and the table
above in sync.
