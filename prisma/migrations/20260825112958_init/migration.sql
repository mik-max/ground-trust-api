-- CreateEnum
CREATE TYPE "Role" AS ENUM ('resident', 'newcomer', 'government', 'admin');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('email', 'google');

-- CreateEnum
CREATE TYPE "VerificationTier" AS ENUM ('tier0', 'tier1', 'tier2', 'tier3');

-- CreateEnum
CREATE TYPE "VerificationEventType" AS ENUM ('gps_sample', 'tier_upgrade', 'manual_review');

-- CreateEnum
CREATE TYPE "Aspect" AS ENUM ('power', 'water', 'security', 'roads_flooding', 'accessibility');

-- CreateEnum
CREATE TYPE "Band" AS ENUM ('poor', 'fair', 'good', 'excellent');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('approved', 'pending', 'rejected');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "authProvider" "AuthProvider" NOT NULL DEFAULT 'email',
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "eventType" "VerificationEventType" NOT NULL,
    "sampledAtNight" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAreaResidency" (
    "userId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "verificationTier" "VerificationTier" NOT NULL DEFAULT 'tier0',
    "confirmedSince" TIMESTAMP(3),
    "trustWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.3,

    CONSTRAINT "UserAreaResidency_pkey" PRIMARY KEY ("userId","areaId")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "geoCentroidLat" DOUBLE PRECISION NOT NULL,
    "geoCentroidLng" DOUBLE PRECISION NOT NULL,
    "geoRadiusMeters" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalText" TEXT,
    "originalLanguage" TEXT,
    "originalAudioRef" TEXT,
    "translatedText" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ratingPower" INTEGER,
    "ratingWater" INTEGER,
    "ratingSecurity" INTEGER,
    "ratingRoadsFlooding" INTEGER,
    "ratingAccessibility" INTEGER,
    "nlpAspects" JSONB,
    "trustWeightAtSubmission" DOUBLE PRECISION NOT NULL,
    "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'approved',

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AreaScore" (
    "areaId" TEXT NOT NULL,
    "aspect" "Aspect" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "band" "Band" NOT NULL,
    "contributorCount" INTEGER NOT NULL,
    "confidenceLevel" "ConfidenceLevel" NOT NULL,
    "lastUpdated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AreaScore_pkey" PRIMARY KEY ("areaId","aspect")
);

-- CreateTable
CREATE TABLE "Flag" (
    "id" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "aspect" "Aspect" NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL,
    "consecutiveWeeksBelowThreshold" INTEGER NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Flag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "VerificationEvent_userId_areaId_idx" ON "VerificationEvent"("userId", "areaId");

-- CreateIndex
CREATE INDEX "Review_areaId_idx" ON "Review"("areaId");

-- CreateIndex
CREATE INDEX "Review_userId_idx" ON "Review"("userId");

-- CreateIndex
CREATE INDEX "Flag_areaId_resolved_idx" ON "Flag"("areaId", "resolved");

-- AddForeignKey
ALTER TABLE "VerificationEvent" ADD CONSTRAINT "VerificationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEvent" ADD CONSTRAINT "VerificationEvent_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAreaResidency" ADD CONSTRAINT "UserAreaResidency_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAreaResidency" ADD CONSTRAINT "UserAreaResidency_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaScore" ADD CONSTRAINT "AreaScore_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
