import { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import type { RaffleStatus } from '@prisma/client';
import type { AuthRequest } from '../middleware/auth.middleware';

export const listRaffles = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, search, page = '1', limit = '12' } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const where: Prisma.RaffleWhereInput = { isPrivate: false };

    if (status && ['DRAFT', 'ACTIVE', 'ENDED', 'CANCELLED'].includes(status.toUpperCase())) {
      where.status = status.toUpperCase() as RaffleStatus;
    }

    if (search?.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { description: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const [total, raffles] = await Promise.all([
      prisma.raffle.count({ where }),
      prisma.raffle.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          description: true,
          prize: true,
          status: true,
          startDate: true,
          endDate: true,
          drawDate: true,
          maxParticipants: true,
          winnersCount: true,
          algorithm: true,
          createdAt: true,
          createdBy: {
            select: { id: true, name: true, businessName: true },
          },
          _count: { select: { entries: true } },
        },
      }),
    ]);

    res.json({
      data: raffles.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        prize: r.prize,
        status: r.status,
        startDate: r.startDate,
        endDate: r.endDate,
        drawDate: r.drawDate,
        maxParticipants: r.maxParticipants,
        winnersCount: r.winnersCount,
        algorithm: r.algorithm,
        createdAt: r.createdAt,
        createdBy: r.createdBy,
        entriesCount: r._count.entries,
      })),
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch raffles' });
  }
};

export const getRaffle = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const [raffle, entriesCount] = await Promise.all([
      prisma.raffle.findFirst({
        where: { id, isPrivate: false },
        include: {
          createdBy: { select: { id: true, name: true, businessName: true } },
          auditLog: true,
        },
      }),
      prisma.entry.count({ where: { raffleId: id } }),
    ]);

    if (!raffle) {
      res.status(404).json({ message: 'Raffle not found' });
      return;
    }

    res.json({ ...raffle, entriesCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch raffle' });
  }
};

export const createRaffle = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, prize, startDate, endDate, drawDate, maxParticipants, winnersCount = 1 } = req.body as {
      name: string; description: string; prize: string;
      startDate: string; endDate: string; drawDate: string;
      maxParticipants?: number | null; winnersCount?: number;
    };

    if (!name || !description || !prize || !startDate || !endDate || !drawDate) {
      res.status(400).json({ message: 'Missing required fields' });
      return;
    }

    const raffle = await prisma.raffle.create({
      data: {
        name: name.trim(),
        description: description.trim(),
        prize: prize.trim(),
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        drawDate: new Date(drawDate),
        maxParticipants: maxParticipants ?? null,
        winnersCount,
        status: 'ACTIVE',
        createdById: req.userId as string,
      },
    });

    res.status(201).json(raffle);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create raffle' });
  }
};

export const getMyRaffles = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const raffles = await prisma.raffle.findMany({
      where: { createdById: req.userId as string },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { entries: true } },
        auditLog: { select: { winnerIds: true } },
      },
    });

    res.json({
      data: raffles.map((r) => ({
        ...r,
        entriesCount: r._count.entries,
        _count: undefined,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch your raffles' });
  }
};
