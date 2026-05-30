-- DropForeignKey
ALTER TABLE "HouseholdInvite" DROP CONSTRAINT "HouseholdInvite_householdId_fkey";

-- DropForeignKey
ALTER TABLE "HouseholdInvite" DROP CONSTRAINT "HouseholdInvite_createdById_fkey";

-- DropTable
DROP TABLE "HouseholdInvite";

-- AlterTable
ALTER TABLE "Household" ADD COLUMN "inviteCode" TEXT;

-- Backfill existing households with unique 8-char codes
UPDATE "Household"
SET "inviteCode" = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
WHERE "inviteCode" IS NULL;

-- Ensure uniqueness for any accidental collisions
DO $$
DECLARE
  household_row RECORD;
  new_code TEXT;
BEGIN
  FOR household_row IN
    SELECT h1."id"
    FROM "Household" h1
    GROUP BY h1."id", h1."inviteCode"
    HAVING (
      SELECT COUNT(*)
      FROM "Household" h2
      WHERE h2."inviteCode" = h1."inviteCode"
    ) > 1
  LOOP
    LOOP
      new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "Household" WHERE "inviteCode" = new_code
      );
    END LOOP;
    UPDATE "Household" SET "inviteCode" = new_code WHERE "id" = household_row."id";
  END LOOP;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "Household_inviteCode_key" ON "Household"("inviteCode");

-- AlterTable
ALTER TABLE "Household" ALTER COLUMN "inviteCode" SET NOT NULL;
