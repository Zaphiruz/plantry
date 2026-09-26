-- AlterTable
ALTER TABLE "items" ADD COLUMN     "group_id" UUID;

-- CreateTable
CREATE TABLE "item_groups" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "min_stock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "preferred_store_id" UUID,
    "renotify_after_days" INTEGER NOT NULL DEFAULT 7,
    "last_notified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "item_groups_household_id_idx" ON "item_groups"("household_id");

-- CreateIndex
CREATE INDEX "items_group_id_idx" ON "items"("group_id");

-- AddForeignKey
ALTER TABLE "item_groups" ADD CONSTRAINT "item_groups_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_groups" ADD CONSTRAINT "item_groups_preferred_store_id_fkey" FOREIGN KEY ("preferred_store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "item_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
