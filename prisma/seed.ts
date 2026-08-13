import { PrismaClient, RaffleStatus, DrawAlgorithm } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('password123', 12);

  const business = await prisma.user.upsert({
    where: { email: 'business@demo.com' },
    update: {},
    create: {
      email: 'business@demo.com',
      name: 'Demo Business',
      password: hashedPassword,
      role: 'BUSINESS',
      businessName: 'TechGiveaways Ltd',
    },
  });

  await prisma.user.upsert({
    where: { email: 'participant@demo.com' },
    update: {},
    create: {
      email: 'participant@demo.com',
      name: 'Demo Participant',
      password: hashedPassword,
      role: 'PARTICIPANT',
    },
  });

  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
  const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const raffles = [
    {
      name: 'MacBook Pro M4 Giveaway',
      description: 'Win a brand new MacBook Pro M4 with 16GB RAM and 512GB SSD. One lucky winner will be selected at random from all valid entries. The draw is fully auditable — every participant can verify the result.',
      prize: 'MacBook Pro M4 (16GB / 512GB)',
      status: RaffleStatus.ACTIVE,
      startDate: oneWeekAgo,
      endDate: in7Days,
      drawDate: in7Days,
      maxParticipants: 500,
      winnersCount: 1,
      algorithm: DrawAlgorithm.UNIFORM,
    },
    {
      name: 'iPhone 16 Pro Max Bundle',
      description: 'Enter for a chance to win an iPhone 16 Pro Max complete with AirPods Pro and MagSafe charger. Full draw audit log published immediately after the draw.',
      prize: 'iPhone 16 Pro Max + AirPods Pro',
      status: RaffleStatus.ACTIVE,
      startDate: oneWeekAgo,
      endDate: in3Days,
      drawDate: in3Days,
      maxParticipants: 1000,
      winnersCount: 1,
      algorithm: DrawAlgorithm.UNIFORM,
    },
    {
      name: 'PlayStation 5 + 3 Games',
      description: 'Win a PlayStation 5 Disc Edition bundled with 3 top-rated games of your choice. Transparent draw — seed and algorithm published before entries open.',
      prize: 'PlayStation 5 + 3 Games',
      status: RaffleStatus.ACTIVE,
      startDate: oneWeekAgo,
      endDate: in14Days,
      drawDate: in14Days,
      maxParticipants: 2000,
      winnersCount: 1,
      algorithm: DrawAlgorithm.UNIFORM,
    },
    {
      name: '$5,000 Cash Prize Draw',
      description: 'Win five thousand dollars cash, paid directly to your bank account or via PayPal within 3 business days of the draw. Three winners selected.',
      prize: '$5,000 USD Cash',
      status: RaffleStatus.ACTIVE,
      startDate: now,
      endDate: in30Days,
      drawDate: in30Days,
      maxParticipants: 5000,
      winnersCount: 3,
      algorithm: DrawAlgorithm.UNIFORM,
    },
    {
      name: 'Gaming PC Build (RTX 4080)',
      description: 'A fully assembled, high-end gaming PC featuring an RTX 4080, Intel i9, 32GB DDR5, and 2TB NVMe. Shipped worldwide.',
      prize: 'Custom Gaming PC (RTX 4080 Super)',
      status: RaffleStatus.ACTIVE,
      startDate: oneWeekAgo,
      endDate: in14Days,
      drawDate: in14Days,
      maxParticipants: null,
      winnersCount: 1,
      algorithm: DrawAlgorithm.UNIFORM,
    },
    {
      name: 'Apple Watch Ultra 2',
      description: 'Premium smartwatch giveaway. The Apple Watch Ultra 2 in titanium, with Alpine Loop band included.',
      prize: 'Apple Watch Ultra 2 + Alpine Loop',
      status: RaffleStatus.ACTIVE,
      startDate: now,
      endDate: in30Days,
      drawDate: in30Days,
      maxParticipants: 800,
      winnersCount: 2,
      algorithm: DrawAlgorithm.UNIFORM,
    },
    {
      name: 'Luxury Hotel Weekend (Paris)',
      description: 'Win a 3-night stay for two at a 5-star hotel in Paris, including breakfast and airport transfers.',
      prize: '3-Night Paris Hotel Stay for 2',
      status: RaffleStatus.ACTIVE,
      startDate: inOneHour,
      endDate: in14Days,
      drawDate: in14Days,
      maxParticipants: 300,
      winnersCount: 1,
      algorithm: DrawAlgorithm.UNIFORM,
    },
    {
      name: 'Sony WH-1000XM5 Headphones',
      description: 'Five lucky winners each receive a pair of Sony WH-1000XM5 noise-cancelling headphones. The draw is open to all registered participants.',
      prize: 'Sony WH-1000XM5 Headphones',
      status: RaffleStatus.ENDED,
      startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      endDate: yesterday,
      drawDate: yesterday,
      maxParticipants: 1000,
      winnersCount: 5,
      algorithm: DrawAlgorithm.UNIFORM,
    },
  ];

  for (const raffle of raffles) {
    await prisma.raffle.create({
      data: {
        ...raffle,
        createdById: business.id,
      },
    });
  }

  console.log('Seed complete — 2 users, 8 raffles');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
