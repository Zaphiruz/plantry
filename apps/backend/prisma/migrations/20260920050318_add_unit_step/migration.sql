-- AlterTable
ALTER TABLE "units" ADD COLUMN     "step" DECIMAL(12,3) NOT NULL DEFAULT 1;

-- CheckConstraint
ALTER TABLE "units" ADD CONSTRAINT "units_step_pos" CHECK ("step" >= 0.01);

-- Set non-default steps for global (household_id IS NULL) units.
UPDATE "units" SET "step" = 0.1 WHERE "household_id" IS NULL AND "name" IN ('lb', 'kg', 'l');
UPDATE "units" SET "step" = 0.25 WHERE "household_id" IS NULL AND "name" = 'gallon';
