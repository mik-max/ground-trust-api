-- AlterTable
ALTER TABLE "Area" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "status" "ModerationStatus" NOT NULL DEFAULT 'approved';

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
