-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VerificationEventType" ADD VALUE 'tier_downgrade';
ALTER TYPE "VerificationEventType" ADD VALUE 'gps_rejected';

-- AlterTable
ALTER TABLE "VerificationEvent" ADD COLUMN     "detail" TEXT;

-- CreateIndex
CREATE INDEX "VerificationEvent_userId_createdAt_idx" ON "VerificationEvent"("userId", "createdAt");
