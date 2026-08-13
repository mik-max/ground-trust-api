import { Request, Response } from 'express';
import prisma from '../config/prisma';
import type { AuthRequest } from '../middleware/auth.middleware';

async function getFraudScore(userId: string, raffleId: string): Promise<{ score: number; flagged: boolean; reason: string | null }> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
    const accountAgeDays = user ? (Date.now() - new Date(user.createdAt).getTime()) / 86_400_000 : 999;

    const recentEntries = await prisma.entry.count({
      where: { userId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });

    let score = 0;
    let reason: string | null = null;

    if (accountAgeDays < 1) { score += 0.6; reason = 'Account created less than 24 hours ago'; }
    else if (accountAgeDays < 7) { score += 0.3; }

    if (recentEntries >= 10) { score += 0.5; reason = reason ?? 'High entry frequency in past hour'; }
    else if (recentEntries >= 5) { score += 0.2; }

    score = Math.min(1, score);
    return { score, flagged: score >= 0.7, reason: score >= 0.7 ? reason : null };
  } catch {
    return { score: 0, flagged: false, reason: null };
  }
}

export const enterRaffle = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const raffleId = req.params.id as string;
    const userId = req.userId as string;

    const raffle = await prisma.raffle.findFirst({
      where: { id: raffleId, isPrivate: false },
    });

    if (!raffle) {
      res.status(404).json({ message: 'Raffle not found' });
      return;
    }

    if (raffle.status !== 'ACTIVE') {
      res.status(400).json({ message: 'This raffle is not currently accepting entries' });
      return;
    }

    if (new Date() > new Date(raffle.endDate)) {
      res.status(400).json({ message: 'Entry deadline has passed' });
      return;
    }

    const existing = await prisma.entry.findUnique({
      where: { raffleId_userId: { raffleId, userId } },
    });

    if (existing) {
      res.status(409).json({ message: 'You have already entered this raffle' });
      return;
    }

    if (raffle.maxParticipants) {
      const count = await prisma.entry.count({ where: { raffleId } });
      if (count >= raffle.maxParticipants) {
        res.status(400).json({ message: 'This raffle has reached its maximum number of participants' });
        return;
      }
    }

    const { score, flagged, reason } = await getFraudScore(userId, raffleId);

    const entry = await prisma.entry.create({
      data: { raffleId, userId, riskScore: score, isFlagged: flagged, flagReason: reason },
    });

    res.status(201).json({
      id: entry.id,
      raffleId: entry.raffleId,
      createdAt: entry.createdAt,
      isFlagged: entry.isFlagged,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to enter raffle' });
  }
};

export const getMyEntry = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const entry = await prisma.entry.findUnique({
      where: {
        raffleId_userId: {
          raffleId: req.params.id as string,
          userId: req.userId as string,
        },
      },
      select: { id: true, createdAt: true, isFlagged: true },
    });

    res.json({ entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch entry status' });
  }
};

export const getMyEntries = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const entries = await prisma.entry.findMany({
      where: { userId: req.userId as string },
      orderBy: { createdAt: 'desc' },
      include: {
        raffle: {
          select: {
            id: true,
            name: true,
            prize: true,
            status: true,
            drawDate: true,
            endDate: true,
            winnersCount: true,
            auditLog: { select: { winnerIds: true } },
          },
        },
      },
    });

    const result = entries.map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      raffle: e.raffle,
      won: e.raffle.auditLog?.winnerIds.includes(e.userId) ?? false,
    }));

    res.json({ data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch entries' });
  }
};
