-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('owner', 'member');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('restock', 'consume', 'adjust', 'auto_deduct');

-- CreateTable
CREATE TABLE "users" (
    "sub" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "last_login_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("sub")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id_hash" TEXT NOT NULL,
    "user_sub" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id_hash")
);

-- CreateTable
CREATE TABLE "households" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_members" (
    "household_id" UUID NOT NULL,
    "user_sub" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_members_pkey" PRIMARY KEY ("household_id","user_sub")
);

-- CreateTable
CREATE TABLE "household_invites" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "household_id" UUID NOT NULL,
    "created_by" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_by" TEXT,
    "accepted_at" TIMESTAMPTZ(6),

    CONSTRAINT "household_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "plural_name" TEXT,
    "abbreviation" TEXT,
    "household_id" UUID,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "unit_id" UUID NOT NULL,
    "preferred_store_id" UUID,
    "barcode" TEXT,
    "image_ref" TEXT,
    "renotify_after_days" INTEGER NOT NULL DEFAULT 7,
    "default_restock_qty" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "auto_deduct_qty" DECIMAL(12,3),
    "auto_deduct_period_days" INTEGER NOT NULL DEFAULT 1,
    "auto_deduct_paused" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(6),
    "archived_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "item_id" UUID NOT NULL,
    "current_count" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "min_stock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "last_restocked_at" TIMESTAMPTZ(6),
    "last_checked_off_at" TIMESTAMPTZ(6),
    "last_auto_deduct_at" TIMESTAMPTZ(6),
    "last_notified_at" TIMESTAMPTZ(6),

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "inventory_events" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "event_type" "EventType" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "note" TEXT,
    "user_sub" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_merges" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "merged_by" TEXT,
    "merged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_merges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_list_items" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "item_id" UUID,
    "name" TEXT NOT NULL,
    "store_id" UUID,
    "quantity" DECIMAL(12,3),
    "added_by" TEXT,
    "checked_off" BOOLEAN NOT NULL DEFAULT false,
    "checked_off_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopping_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "endpoint" TEXT NOT NULL,
    "user_sub" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("endpoint")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "job" TEXT NOT NULL,
    "last_run_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("job")
);

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "household_members_user_sub_idx" ON "household_members"("user_sub");

-- CreateIndex
CREATE UNIQUE INDEX "household_invites_token_hash_key" ON "household_invites"("token_hash");

-- CreateIndex
CREATE INDEX "stores_household_id_idx" ON "stores"("household_id");

-- CreateIndex
CREATE INDEX "units_household_id_idx" ON "units"("household_id");

-- CreateIndex
CREATE INDEX "items_household_id_archived_at_idx" ON "items"("household_id", "archived_at");

-- CreateIndex
CREATE INDEX "inventory_events_item_id_created_at_idx" ON "inventory_events"("item_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_events_household_id_created_at_idx" ON "inventory_events"("household_id", "created_at");

-- CreateIndex
CREATE INDEX "shopping_list_items_household_id_idx" ON "shopping_list_items"("household_id");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_sub_idx" ON "push_subscriptions"("user_sub");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_sub_fkey" FOREIGN KEY ("user_sub") REFERENCES "users"("sub") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_sub_fkey" FOREIGN KEY ("user_sub") REFERENCES "users"("sub") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("sub") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("sub") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_preferred_store_id_fkey" FOREIGN KEY ("preferred_store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_archived_by_fkey" FOREIGN KEY ("archived_by") REFERENCES "users"("sub") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_events" ADD CONSTRAINT "inventory_events_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_events" ADD CONSTRAINT "inventory_events_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_events" ADD CONSTRAINT "inventory_events_user_sub_fkey" FOREIGN KEY ("user_sub") REFERENCES "users"("sub") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_merges" ADD CONSTRAINT "item_merges_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_merges" ADD CONSTRAINT "item_merges_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_merges" ADD CONSTRAINT "item_merges_merged_by_fkey" FOREIGN KEY ("merged_by") REFERENCES "users"("sub") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("sub") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_sub_fkey" FOREIGN KEY ("user_sub") REFERENCES "users"("sub") ON DELETE CASCADE ON UPDATE CASCADE;


-- Partial unique indexes (not expressible in schema.prisma)
CREATE UNIQUE INDEX "items_household_barcode_active_key"
  ON "items" ("household_id", "barcode")
  WHERE "barcode" IS NOT NULL AND "archived_at" IS NULL;

CREATE UNIQUE INDEX "sli_household_item_open_key"
  ON "shopping_list_items" ("household_id", "item_id")
  WHERE "item_id" IS NOT NULL AND NOT "checked_off";

-- Check constraints
ALTER TABLE "items" ADD CONSTRAINT "items_default_restock_qty_pos" CHECK ("default_restock_qty" > 0);
ALTER TABLE "items" ADD CONSTRAINT "items_auto_deduct_qty_pos" CHECK ("auto_deduct_qty" IS NULL OR "auto_deduct_qty" > 0);
ALTER TABLE "items" ADD CONSTRAINT "items_auto_deduct_period_pos" CHECK ("auto_deduct_period_days" >= 1);

-- Global default units (household_id NULL)
INSERT INTO "units" ("id", "name", "plural_name", "abbreviation", "household_id") VALUES
  (gen_random_uuid(), 'each',   'each',    'ea',  NULL),
  (gen_random_uuid(), 'oz',     'oz',      'oz',  NULL),
  (gen_random_uuid(), 'lb',     'lb',      'lb',  NULL),
  (gen_random_uuid(), 'g',      'g',       'g',   NULL),
  (gen_random_uuid(), 'kg',     'kg',      'kg',  NULL),
  (gen_random_uuid(), 'ml',     'ml',      'ml',  NULL),
  (gen_random_uuid(), 'l',      'l',       'l',   NULL),
  (gen_random_uuid(), 'can',    'cans',    NULL,  NULL),
  (gen_random_uuid(), 'bottle', 'bottles', NULL,  NULL),
  (gen_random_uuid(), 'box',    'boxes',   NULL,  NULL),
  (gen_random_uuid(), 'bag',    'bags',    NULL,  NULL),
  (gen_random_uuid(), 'roll',   'rolls',   NULL,  NULL),
  (gen_random_uuid(), 'gallon', 'gallons', 'gal', NULL);
