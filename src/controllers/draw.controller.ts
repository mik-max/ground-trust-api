import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import prisma from '../config/prisma';
import type { AuthRequest } from '../middleware/auth.middleware';

function cryptoRandom(): number {
  const buf = randomBytes(4);
  return buf.readUInt32BE(0) / 0x100000000;
}

function pickWinners(participantIds: string[], count: number, seed: string): string[] {
  const pool = [...participantIds];
  const winners: string[] = [];

  let state = BigInt('0x' + seed.slice(0, 16));
  const pick = () => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & 0xFFFFFFFFFFFFFFFFn;
    return Number(state % BigInt(pool.length));
  };

  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const idx = pick() % pool.length;
    winners.push(pool[idx]);
    pool.splice(idx, 1);
  }

  return winners;
}

export const executeDraw = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const raffleId = req.params.id as string;
    const userId = req.userId as string;

    const raffle = await prisma.raffle.findFirst({
      where: { id: raffleId, createdById: userId },
    });

    if (!raffle) {
      res.status(404).json({ message: 'Raffle not found or you do not own it' });
      return;
    }

    if (raffle.status !== 'ACTIVE') {
      res.status(400).json({ message: 'Only active raffles can be drawn' });
      return;
    }

    const existing = await prisma.auditLog.findUnique({ where: { raffleId } });
    if (existing) {
      res.status(409).json({ message: 'Draw has already been executed for this raffle' });
      return;
    }

    const entries = await prisma.entry.findMany({
      where: { raffleId, isFlagged: false },
      select: { userId: true },
    });

    if (entries.length === 0) {
      res.status(400).json({ message: 'No valid entries to draw from' });
      return;
    }

    const seed = randomBytes(32).toString('hex');
    const participantIds = entries.map((e) => e.userId);
    const winnerIds = pickWinners(participantIds, raffle.winnersCount, seed);

    const [auditLog] = await prisma.$transaction([
      prisma.auditLog.create({
        data: {
          raffleId,
          participantCount: participantIds.length,
          randomSeed: seed,
          algorithm: raffle.algorithm,
          winnerIds,
        },
      }),
      prisma.raffle.update({
        where: { id: raffleId },
        data: { status: 'ENDED' },
      }),
    ]);

    res.json({
      drawExecutedAt: auditLog.drawExecutedAt,
      participantCount: auditLog.participantCount,
      randomSeed: auditLog.randomSeed,
      algorithm: auditLog.algorithm,
      winnerIds: auditLog.winnerIds,
      winnersCount: winnerIds.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Draw execution failed' });
  }
};
