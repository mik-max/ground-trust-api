-- CreateEnum
CREATE TYPE "RaffleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DrawAlgorithm" AS ENUM ('UNIFORM', 'WEIGHTED');

-- CreateTable
CREATE TABLE "Raffle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "prize" TEXT NOT NULL,
    "status" "RaffleStatus" NOT NULL DEFAULT 'DRAFT',
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "inviteToken" TEXT,
    "algorithm" "DrawAlgorithm" NOT NULL DEFAULT 'UNIFORM',
    "winnersCount" INTEGER NOT NULL DEFAULT 1,
    "maxParticipants" INTEGER,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "drawDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Raffle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "flagReason" TEXT,
    "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "raffleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "drawExecutedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "participantCount" INTEGER NOT NULL,
    "randomSeed" TEXT NOT NULL,
    "algorithm" "DrawAlgorithm" NOT NULL,
    "winnerIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raffleId" TEXT NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Raffle_inviteToken_key" ON "Raffle"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "Entry_raffleId_userId_key" ON "Entry"("raffleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_raffleId_key" ON "AuditLog"("raffleId");

-- AddForeignKey
ALTER TABLE "Raffle" ADD CONSTRAINT "Raffle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
