-- CreateTable
CREATE TABLE "item_barcodes" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "item_barcodes_item_id_idx" ON "item_barcodes"("item_id");

-- AddForeignKey
ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one row per item that currently has a barcode, carrying over its archived state.
INSERT INTO item_barcodes (id, item_id, household_id, code, archived, created_at)
SELECT gen_random_uuid(), id, household_id, barcode, archived_at IS NOT NULL, now()
FROM items
WHERE barcode IS NOT NULL;

-- Retire the single-barcode partial unique index — item_barcodes now owns this constraint
-- (see item_barcodes_household_code_active_key below). This is the ONE migration allowed to
-- drop it; src/migrations.test.ts allow-lists this directory specifically.
DROP INDEX "items_household_barcode_active_key";

-- AlterTable
ALTER TABLE "items" DROP COLUMN "barcode";

-- A code identifies at most one *live* item per household; archived items may reuse it.
-- Hand-written: Prisma's schema language cannot express a WHERE clause on a unique index.
CREATE UNIQUE INDEX item_barcodes_household_code_active_key ON item_barcodes (household_id, code) WHERE NOT archived;
