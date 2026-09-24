-- CreateEnum
CREATE TYPE "FlagResponseStatus" AS ENUM ('unacknowledged', 'acknowledged', 'in_progress');

-- AlterTable
ALTER TABLE "Flag" ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "respondedByUserId" TEXT,
ADD COLUMN     "responseNote" TEXT,
ADD COLUMN     "responseStatus" "FlagResponseStatus" NOT NULL DEFAULT 'unacknowledged';

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_respondedByUserId_fkey" FOREIGN KEY ("respondedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
