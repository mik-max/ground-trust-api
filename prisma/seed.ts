import bcrypt from "bcryptjs";
import { PrismaClient, Aspect, VerificationTier } from "../src/generated/prisma";
import { recomputeAreaScore } from "../src/services/scoring.service";
import { RATING_FIELD_BY_ASPECT, TRUST_WEIGHT_BY_TIER } from "../src/config/constants";

const prisma = new PrismaClient();

function slug(name: string) {
  return name.toLowerCase().replace(/\s+/g, "-");
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

// Five real Nigerian neighbourhoods spanning four states, deliberately
// covering the full range of confidence/verification states the UI needs to
// render correctly — not just five identical "happy path" areas.
const AREAS = [
  { name: "GRA Ikeja", city: "Lagos", state: "Lagos", geoCentroidLat: 6.5833, geoCentroidLng: 3.35, geoRadiusMeters: 2000 },
  { name: "Lekki Phase 1", city: "Lagos", state: "Lagos", geoCentroidLat: 6.4478, geoCentroidLng: 3.4726, geoRadiusMeters: 3000 },
  { name: "Wuse 2", city: "Abuja", state: "FCT", geoCentroidLat: 9.0833, geoCentroidLng: 7.4833, geoRadiusMeters: 2500 },
  { name: "Independence Layout", city: "Enugu", state: "Enugu", geoCentroidLat: 6.4483, geoCentroidLng: 7.5, geoRadiusMeters: 2500 },
  { name: "Bodija Estate", city: "Ibadan", state: "Oyo", geoCentroidLat: 7.4177, geoCentroidLng: 3.9081, geoRadiusMeters: 2500 },
] as const;

// Fixed demo logins the app has been tested against — kept stable across
// reseeds so existing bookmarks/muscle memory (resident@example.com etc.)
// keep working. Extra numbered residents exist purely to hit the
// confidence-level thresholds (MIN_N_MEDIUM=5, MIN_N_HIGH=15, MIN_N_FOR_FLAG=8)
// with genuinely distinct contributors, the same way real usage would.
const FIXED_USERS = [
  { fullName: "Demo Admin", email: "admin@example.com", role: "admin" as const },
  { fullName: "Demo Government", email: "gov@example.com", role: "government" as const },
  { fullName: "Demo Resident", email: "resident@example.com", role: "resident" as const },
];

const RESIDENT_NAMES = [
  "Ada Nwosu", "Tunde Bakare", "Chiamaka Okafor", "Ibrahim Musa", "Ngozi Eze",
  "Segun Adewale", "Fatima Bello", "Emeka Chukwu", "Blessing Okon", "Yusuf Aliyu",
  "Grace Effiong", "Chinedu Obi", "Aisha Suleiman", "Kelechi Nnamdi", "Halima Garba",
];

// resident@example.com is treated as resident #0 below (already reviewed
// live during development), so these 15 named accounts are #1-15 — enough
// distinct contributors to push GRA Ikeja past the MIN_N_HIGH=15 threshold.
const NUMBERED_RESIDENTS = RESIDENT_NAMES.map((fullName, i) => ({
  fullName,
  email: `resident${i + 1}@example.com`,
  role: "resident" as const,
}));

// Tiers cycle deterministically rather than randomly, so reseeding is
// reproducible. tier0 = just registered (weight 0.3), tier1 =
// location-confirmed (0.7, confirmedSince ~20 days ago — still short of
// tier2's 60-day mark, so My Contributions shows real in-progress state),
// tier2 = verified resident (1.0, confirmedSince ~90 days ago).
function tierForIndex(i: number): { tier: VerificationTier; confirmedSince: Date | null } {
  const cycle = i % 3;
  if (cycle === 0) return { tier: "tier0", confirmedSince: null };
  if (cycle === 1) return { tier: "tier1", confirmedSince: daysAgo(20) };
  return { tier: "tier2", confirmedSince: daysAgo(90) };
}

interface ReviewPlan {
  residentIndex: number; // 0 = resident@example.com, 1-15 = numbered residents
  ratings: Partial<Record<Aspect, number>>;
  text?: string;
  daysAgoSubmitted: number;
  moderationStatus?: "approved" | "pending";
}

// Each block deliberately targets a specific confidence/flag state:
//  - GRA Ikeja: 15 contributors -> high confidence. Security is weak (2.2)
//    but stays just above FLAG_THRESHOLD (2.0), so it reads as a real
//    problem area without being flagged — flagging isn't just "the worst
//    score in the list", it's a specific, crossed threshold.
//  - Lekki Phase 1: 6 contributors -> medium confidence, generally strong.
//  - Wuse 2: 3 contributors -> low confidence, still forming a picture.
//  - Independence Layout: 1 contributor -> the "be the first" adjacent
//    cold-start state with just barely enough to render at all.
//  - Bodija Estate: 9 contributors on security specifically (>= the
//    MIN_N_FOR_FLAG=8 floor) rated 1-2, well under the 2.0 threshold —
//    this is the one area that genuinely earns a Flag row, while power/
//    water/roads/accessibility stay healthy, showing the flag is
//    aspect-specific, not a verdict on the whole area.
// Comments are in English plus three each in Nigerian Pidgin, Yoruba,
// Hausa and Igbo (matched to the reviewer's name), attached to reviews that
// already existed, so the ratings above, and the scores and flag they
// produce, are unaffected. They exercise the translation and aspect/sentiment
// pipeline on the supported local languages.
const REVIEW_PLANS: Record<(typeof AREAS)[number]["name"], ReviewPlan[]> = {
  "GRA Ikeja": [
    { residentIndex: 0, ratings: { power: 3, water: 4, security: 2 }, text: "Power has improved a lot this year, but I still don't feel safe walking around after dark.", daysAgoSubmitted: 3 },
    { residentIndex: 1, ratings: { power: 4, security: 2, roads_flooding: 3 }, text: "Ọkụ latrik na-adị mma ebe a ugbu a. Mana nchekwa adịghị mma ma ọlị, ndị ohi batara n'ụlọ abụọ n'okporo ụzọ anyị n'ọnwa a.", daysAgoSubmitted: 5 },
    { residentIndex: 2, ratings: { power: 3, water: 3, security: 3, accessibility: 4 }, text: "Decent estate overall, close to the airport which is handy.", daysAgoSubmitted: 8 },
    { residentIndex: 3, ratings: { security: 2, roads_flooding: 2 }, daysAgoSubmitted: 10 },
    { residentIndex: 4, ratings: { power: 4, water: 4, accessibility: 3 }, text: "Wutar lantarki tana zuwa sosai a nan, ruwan famfo ma yana samuwa kullum. Amma hanyoyin tafiya ba su da sauƙi ga tsofaffi.", daysAgoSubmitted: 12 },
    { residentIndex: 5, ratings: { power: 2, security: 2, water: 3 }, text: "We've had a few break-ins reported on the estate WhatsApp group recently.", daysAgoSubmitted: 14 },
    { residentIndex: 6, ratings: { power: 3, roads_flooding: 3, accessibility: 4 }, text: "Iná mànàmáná máa ń wá, ṣùgbọ́n kì í pẹ́. Ọ̀nà wa kò burú, àwọn àgbàlagbà sì lè rìn dé ọjà láìsí wàhálà.", daysAgoSubmitted: 16 },
    { residentIndex: 7, ratings: { security: 1, power: 3 }, text: "This is placeholder text simulating a review that gets flagged by moderation for testing.", daysAgoSubmitted: 18, moderationStatus: "pending" },
    // Same resident, a separate approved review — a realistic follow-up,
    // and keeps GRA Ikeja's overall approved-contributor count at a clean
    // 15 (the pending row above doesn't count) so it actually clears
    // MIN_N_HIGH and renders "high confidence", not just "medium".
    { residentIndex: 7, ratings: { water: 3, accessibility: 3 }, daysAgoSubmitted: 17 },
    { residentIndex: 8, ratings: { power: 4, water: 3, security: 2 }, daysAgoSubmitted: 20 },
    { residentIndex: 9, ratings: { power: 3, security: 3, accessibility: 3 }, daysAgoSubmitted: 22 },
    { residentIndex: 10, ratings: { power: 3, water: 4, roads_flooding: 2 }, text: "Roads flood badly right at the estate gate whenever it rains hard.", daysAgoSubmitted: 25 },
    { residentIndex: 11, ratings: { security: 2, power: 4 }, text: "Light dey stay well for here, but security no good at all. Dem don rob people for our street two times this month.", daysAgoSubmitted: 28 },
    { residentIndex: 12, ratings: { power: 3, water: 3, security: 2, accessibility: 4 }, text: "Ọ dị mfe ịga ahịa na ụlọ ọgwụ site n'ebe a. Mana anyị anaghị enwe udo n'abalị n'ihi ndị ohi.", daysAgoSubmitted: 30 },
    { residentIndex: 13, ratings: { power: 4, roads_flooding: 3 }, text: "Wuta tana nan kusan kullum. Titin yana da kyau, amma idan ruwan sama ya yi yawa sai ruwa ya cika shi.", daysAgoSubmitted: 33 },
    { residentIndex: 14, ratings: { security: 3, water: 4, power: 3 }, text: "Quiet, established neighbourhood — one of the better parts of Ikeja for power supply.", daysAgoSubmitted: 35 },
  ],
  "Lekki Phase 1": [
    { residentIndex: 1, ratings: { power: 4, water: 4, security: 4, accessibility: 3 }, text: "Great place to live if you can handle the Third Mainland Bridge traffic to get here.", daysAgoSubmitted: 4 },
    { residentIndex: 2, ratings: { power: 4, security: 4, roads_flooding: 3 }, text: "Iná mànàmáná dúró dáadáa, ààbò sì dára nínú estate wa. Ṣùgbọ́n omi máa ń kún ọ̀nà kan nígbà òjò.", daysAgoSubmitted: 9 },
    { residentIndex: 3, ratings: { power: 3, water: 4, accessibility: 4 }, text: "Water dey run every day, we no dey buy water again. Light dey try small. E easy to waka reach market and bus stop.", daysAgoSubmitted: 15 },
    { residentIndex: 4, ratings: { security: 4, power: 4, water: 3 }, text: "Private estate security is solid — haven't had any issues in two years here.", daysAgoSubmitted: 21 },
    { residentIndex: 5, ratings: { power: 3, roads_flooding: 2, accessibility: 3 }, text: "Flooding near the lekki-epe expressway side is a real problem in the rainy season.", daysAgoSubmitted: 27 },
    { residentIndex: 6, ratings: { power: 4, water: 4, security: 3 }, daysAgoSubmitted: 40 },
  ],
  "Wuse 2": [
    { residentIndex: 7, ratings: { power: 5, water: 4, security: 4 }, text: "Central, well-planned, and power is far more stable than most of Abuja.", daysAgoSubmitted: 6 },
    { residentIndex: 8, ratings: { power: 5, accessibility: 3, water: 3 }, text: "Ọkụ adịghị anyụ ebe a, ọ bụ nke kacha mma n'Abuja. Mmiri na-abịa mgbe ụfọdụ, ọ bụghị kwa ụbọchị.", daysAgoSubmitted: 19 },
    { residentIndex: 9, ratings: { security: 2, power: 4, roads_flooding: 3 }, text: "Night time no safe for this side at all, thief dey operate. Light sef dey constant, na only security be the wahala.", daysAgoSubmitted: 31 },
  ],
  "Independence Layout": [
    { residentIndex: 10, ratings: { power: 4, water: 1, roads_flooding: 2, accessibility: 3 }, text: "Water supply is basically nonexistent — everyone here relies on boreholes.", daysAgoSubmitted: 11 },
  ],
  "Bodija Estate": [
    { residentIndex: 0, ratings: { security: 1, power: 4, water: 4 }, text: "Loved living here until a spate of armed robberies on our street last quarter.", daysAgoSubmitted: 2 },
    { residentIndex: 2, ratings: { security: 2, power: 3, roads_flooding: 3 }, text: "Ẹ̀rù ń bà wá lálẹ́ nítorí àwọn olè ti pọ̀ sí i ládùúgbò yìí. Iná máa ń wá díẹ̀díẹ̀.", daysAgoSubmitted: 7 },
    { residentIndex: 5, ratings: { security: 1, water: 4 }, text: "Reported two incidents to the police this year alone — security here has gotten worse.", daysAgoSubmitted: 13 },
    { residentIndex: 8, ratings: { security: 2, power: 4, accessibility: 4 }, daysAgoSubmitted: 17 },
    { residentIndex: 11, ratings: { security: 1, water: 3 }, daysAgoSubmitted: 23 },
    { residentIndex: 12, ratings: { security: 2, power: 3, roads_flooding: 4 }, text: "Good schools nearby and the market is convenient, but I don't feel safe at night anymore.", daysAgoSubmitted: 29 },
    { residentIndex: 13, ratings: { security: 1, power: 4 }, text: "Tsaro ya lalace gaba ɗaya a unguwar nan, 'yan fashi suna shigowa da dare. Wuta kam tana nan lafiya.", daysAgoSubmitted: 34 },
    { residentIndex: 14, ratings: { security: 2, water: 4, accessibility: 3 }, daysAgoSubmitted: 38 },
    { residentIndex: 3, ratings: { security: 1, power: 3, water: 3 }, daysAgoSubmitted: 42 },
  ],
};

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  // --- Areas ---
  const areaByName = new Map<string, string>();
  for (const area of AREAS) {
    const id = slug(area.name);
    await prisma.area.create({ data: { id, ...area } });
    areaByName.set(area.name, id);
  }

  // --- Users (fixed demo accounts + numbered residents) ---
  for (const user of FIXED_USERS) {
    await prisma.user.create({ data: { ...user, passwordHash, authProvider: "email" } });
  }
  for (const user of NUMBERED_RESIDENTS) {
    await prisma.user.create({ data: { ...user, passwordHash, authProvider: "email" } });
  }

  const residentEmailByIndex = (i: number) => (i === 0 ? "resident@example.com" : `resident${i}@example.com`);
  const userIdByEmail = new Map<string, string>();
  const allUsers = await prisma.user.findMany({ select: { id: true, email: true } });
  for (const u of allUsers) userIdByEmail.set(u.email, u.id);

  // --- Residencies + reviews, per area ---
  const touchedAreaAspect = new Set<string>();

  for (const area of AREAS) {
    const areaId = areaByName.get(area.name)!;
    const plans = REVIEW_PLANS[area.name];

    for (const plan of plans) {
      const userId = userIdByEmail.get(residentEmailByIndex(plan.residentIndex))!;
      const { tier, confirmedSince } = tierForIndex(plan.residentIndex);
      const trustWeight = TRUST_WEIGHT_BY_TIER[tier];

      await prisma.userAreaResidency.upsert({
        where: { userId_areaId: { userId, areaId } },
        update: {},
        create: { userId, areaId, verificationTier: tier, confirmedSince, trustWeight },
      });

      const ratingData: Record<string, number> = {};
      for (const [aspect, rating] of Object.entries(plan.ratings)) {
        ratingData[RATING_FIELD_BY_ASPECT[aspect as Aspect]] = rating as number;
        touchedAreaAspect.add(`${areaId}:${aspect}`);
      }

      await prisma.review.create({
        data: {
          areaId,
          userId,
          originalText: plan.text,
          trustWeightAtSubmission: trustWeight,
          moderationStatus: plan.moderationStatus ?? "approved",
          submittedAt: daysAgo(plan.daysAgoSubmitted),
          ...ratingData,
        },
      });
    }
  }

  // --- Real recompute for every touched area/aspect, so AreaScore reflects
  // the exact same trust-weighted-mean/band/confidence math the live app
  // uses — no hand-faked numbers. ---
  for (const key of touchedAreaAspect) {
    const [areaId, aspect] = key.split(":");
    await recomputeAreaScore(areaId, aspect as Aspect);
  }

  // Bodija Estate's security flag genuinely triggers from the data above
  // (9 contributors, well under FLAG_THRESHOLD), but a freshly-triggered
  // flag only carries streak=1 — not yet "persisted" long enough to be
  // government-actionable (MIN_WEEKS_PERSISTENT=4). Backdating this one
  // flag simulates it having actually been sampled by the weekly sweep for
  // 5 consecutive weeks, the only piece of this seed that fakes elapsed
  // time rather than deriving it from real data.
  const bodijaId = areaByName.get("Bodija Estate")!;
  await prisma.flag.updateMany({
    where: { areaId: bodijaId, aspect: "security", resolved: false },
    data: { consecutiveWeeksBelowThreshold: 5, triggeredAt: daysAgo(7) },
  });

  const areaCount = AREAS.length;
  const userCount = FIXED_USERS.length + NUMBERED_RESIDENTS.length;
  const reviewCount = Object.values(REVIEW_PLANS).reduce((sum, plans) => sum + plans.length, 0);
  console.log(`Seeded ${areaCount} areas, ${userCount} users, ${reviewCount} reviews.`);
  console.log("Demo login password for all seeded users: password123");
  console.log("Fixed logins: admin@example.com, gov@example.com, resident@example.com");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
