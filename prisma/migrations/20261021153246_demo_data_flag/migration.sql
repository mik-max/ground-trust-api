-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- Every account the seed script creates uses an @example.com address (a
-- reserved domain no real person can register), so those are the demo ones.
UPDATE "User" SET "isDemo" = true WHERE "email" LIKE '%@example.com';
