import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

const AREAS = [
  { name: "Lekki Phase 1", city: "Lagos", state: "Lagos", geoCentroidLat: 6.4478, geoCentroidLng: 3.4726, geoRadiusMeters: 3000 },
  { name: "Wuse 2", city: "Abuja", state: "FCT", geoCentroidLat: 9.0833, geoCentroidLng: 7.4833, geoRadiusMeters: 2500 },
  { name: "GRA Ikeja", city: "Lagos", state: "Lagos", geoCentroidLat: 6.5833, geoCentroidLng: 3.35, geoRadiusMeters: 2000 },
  { name: "Independence Layout", city: "Enugu", state: "Enugu", geoCentroidLat: 6.4483, geoCentroidLng: 7.5, geoRadiusMeters: 2500 },
];

const DEMO_USERS = [
  { fullName: "Demo Resident", email: "resident@example.com", role: "resident" as const },
  { fullName: "Demo Newcomer", email: "newcomer@example.com", role: "newcomer" as const },
  { fullName: "Demo Government", email: "gov@example.com", role: "government" as const },
  // Government accounts are admin-provisioned, not self-service (files/HANDOFF.md
  // §2.5) — but nothing seeds the *first* admin either, so this demo account is
  // the bootstrap path for this project, matching the "admin CLI/script" option
  // HANDOFF suggests for that provisioning route.
  { fullName: "Demo Admin", email: "admin@example.com", role: "admin" as const },
];

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  for (const area of AREAS) {
    await prisma.area.upsert({
      where: { id: area.name.toLowerCase().replace(/\s+/g, "-") },
      update: {},
      create: { id: area.name.toLowerCase().replace(/\s+/g, "-"), ...area },
    });
  }

  for (const user of DEMO_USERS) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: { ...user, passwordHash, authProvider: "email" },
    });
  }

  console.log(`Seeded ${AREAS.length} areas and ${DEMO_USERS.length} demo users.`);
  console.log("Demo login password for all seeded users: password123");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
