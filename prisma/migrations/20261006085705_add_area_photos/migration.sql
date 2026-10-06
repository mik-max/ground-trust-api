-- CreateEnum
CREATE TYPE "AreaPhotoSource" AS ENUM ('curated', 'resident');

-- CreateTable
CREATE TABLE "AreaPhoto" (
    "id" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "source" "AreaPhotoSource" NOT NULL,
    "status" "ModerationStatus" NOT NULL DEFAULT 'pending',
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "credit" TEXT,
    "creditUrl" TEXT,
    "license" TEXT,
    "licenseUrl" TEXT,
    "uploadedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AreaPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AreaPhoto_publicId_key" ON "AreaPhoto"("publicId");

-- CreateIndex
CREATE INDEX "AreaPhoto_areaId_status_idx" ON "AreaPhoto"("areaId", "status");

-- CreateIndex
CREATE INDEX "AreaPhoto_status_createdAt_idx" ON "AreaPhoto"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "AreaPhoto" ADD CONSTRAINT "AreaPhoto_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaPhoto" ADD CONSTRAINT "AreaPhoto_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
