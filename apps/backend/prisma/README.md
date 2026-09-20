# Prisma migrations — read before running `prisma migrate dev`

Two **partial unique indexes** are hand-written in
`migrations/20260919205143_init/migration.sql`. Prisma's schema language cannot
express a `WHERE` clause on a unique index, so `schema.prisma` does not know
they exist:

| index | table | meaning |
| --- | --- | --- |
| `items_household_barcode_active_key` | `items (household_id, barcode) WHERE barcode IS NOT NULL AND archived_at IS NULL` | a barcode identifies at most one *live* item per household; archived items may reuse it |
| `sli_household_item_open_key` | `shopping_list_items (household_id, item_id) WHERE item_id IS NOT NULL AND NOT checked_off` | an item appears at most once as an *open* shopping-list line; checked-off history is unconstrained |

The same file also carries `CHECK` constraints (`items_default_restock_qty_pos`,
`items_auto_deduct_qty_pos`, `items_auto_deduct_period_pos`) and the seed rows
for the 13 global units, all equally invisible to `schema.prisma`.

## Why this matters

`prisma migrate dev` diffs the *database* against `schema.prisma` and writes SQL
to make the database match. Because the schema has no record of these indexes,
Prisma sees them as drift and will happily emit `DROP INDEX
"items_household_barcode_active_key"` into your new migration. Applying that
silently removes the uniqueness guarantee the application relies on — duplicate
barcodes and duplicate open shopping-list lines become possible, with no error
anywhere.

## The workflow

Always create migrations **`--create-only`**, then read the generated SQL before
applying it:

```bash
corepack pnpm --filter @plantry/backend prisma migrate dev --create-only --name your_change
# 1. open prisma/migrations/<timestamp>_your_change/migration.sql
# 2. delete any DROP INDEX / DROP CONSTRAINT line touching the objects above
# 3. apply it
corepack pnpm --filter @plantry/backend prisma migrate dev
# 4. refresh the test database
corepack pnpm --filter @plantry/backend test:db:setup
```

If your change legitimately alters one of these indexes, update it with explicit
`DROP INDEX` + `CREATE UNIQUE INDEX … WHERE …` SQL **and** update the guard.

## The guard

`src/migrations.test.ts` fails the backend suite if either index is missing from
the live test database, or if any `migrations/*/migration.sql` contains a
`DROP INDEX` for either name. Keep the list in that test and the table above in
sync.
