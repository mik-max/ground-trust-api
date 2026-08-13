import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes';
import raffleRoutes from './routes/raffle.routes';
import entryRoutes from './routes/entry.routes';
import drawRoutes from './routes/draw.routes';

const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/raffles', raffleRoutes);
app.use('/api', entryRoutes);
app.use('/api/raffles', drawRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'DrawProof API is running' });
});

app.get('/api/stats', async (_req, res) => {
  try {
    const prisma = (await import('./config/prisma')).default;
    const [raffles, entries, draws] = await Promise.all([
      prisma.raffle.count({ where: { isPrivate: false } }),
      prisma.entry.count(),
      prisma.auditLog.count(),
    ]);
    res.json({ raffles, entries, draws });
  } catch {
    res.json({ raffles: 0, entries: 0, draws: 0 });
  }
});

export default app;
