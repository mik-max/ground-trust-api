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

// Six real Lagos neighbourhoods — the study is scoped to Lagos State — two
// each at high, middle and low income levels (Ikoyi and Lekki Phase 1,
// Surulere and Yaba, Ajegunle and Mushin), deliberately covering the full
// range of confidence/verification/flag states the UI needs to render
// correctly — not just six identical "happy path" areas. Centroids are
// from OpenStreetMap; radii are sized so neighbouring areas don't overlap.
const AREAS = [
  { name: "Ikoyi", city: "Lagos", state: "Lagos", geoCentroidLat: 6.4523, geoCentroidLng: 3.4281, geoRadiusMeters: 2500 },
  { name: "Lekki Phase 1", city: "Lagos", state: "Lagos", geoCentroidLat: 6.4478, geoCentroidLng: 3.4726, geoRadiusMeters: 2400 },
  { name: "Surulere", city: "Lagos", state: "Lagos", geoCentroidLat: 6.4856, geoCentroidLng: 3.354, geoRadiusMeters: 1800 },
  { name: "Yaba", city: "Lagos", state: "Lagos", geoCentroidLat: 6.5068, geoCentroidLng: 3.3755, geoRadiusMeters: 1500 },
  { name: "Ajegunle", city: "Lagos", state: "Lagos", geoCentroidLat: 6.4482, geoCentroidLng: 3.3335, geoRadiusMeters: 1800 },
  { name: "Mushin", city: "Lagos", state: "Lagos", geoCentroidLat: 6.5248, geoCentroidLng: 3.3516, geoRadiusMeters: 1800 },
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
// distinct contributors to push Ikoyi past the MIN_N_HIGH=15 threshold.
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
//  - Ikoyi: 15 contributors -> high confidence. Security is weak (2.2)
//    but stays just above FLAG_THRESHOLD (2.0), so it reads as a real
//    problem area without being flagged — flagging isn't just "the worst
//    score in the list", it's a specific, crossed threshold.
//  - Lekki Phase 1: 6 contributors -> medium confidence, generally strong.
//  - Surulere: 3 contributors -> low confidence, still forming a picture.
//  - Yaba: 1 contributor -> the "be the first" adjacent cold-start state
//    with just barely enough to render at all.
//  - Mushin: 9 contributors on security specifically (>= the
//    MIN_N_FOR_FLAG=8 floor) rated 1-2, well under the 2.0 threshold —
//    a genuine security Flag, while power/water/roads/accessibility stay
//    healthy, showing the flag is aspect-specific, not a verdict on the
//    whole area.
//  - Ajegunle: 8 contributors on roads/flooding rated 1-2 — a second,
//    different-aspect Flag, so the government dashboard shows more than one.
// Comments are in English plus three each in Nigerian Pidgin, Yoruba,
// Hausa and Igbo (matched to the reviewer's name), attached to reviews that
// already existed, so the ratings above, and the scores and flag they
// produce, are unaffected. They exercise the translation and aspect/sentiment
// pipeline on the supported local languages.
const REVIEW_PLANS: Record<(typeof AREAS)[number]["name"], ReviewPlan[]> = {
  "Ikoyi": [
    { residentIndex: 0, ratings: { power: 3, water: 4, security: 2 }, text: "Power has improved a lot this year, but I still don't feel safe walking around after dark.", daysAgoSubmitted: 3 },
    { residentIndex: 1, ratings: { power: 4, security: 2, roads_flooding: 3 }, text: "Ọkụ latrik na-adị mma ebe a ugbu a. Mana nchekwa adịghị mma ma ọlị, ndị ohi batara n'ụlọ abụọ n'okporo ụzọ anyị n'ọnwa a.", daysAgoSubmitted: 5 },
    { residentIndex: 2, ratings: { power: 3, water: 3, security: 3, accessibility: 4 }, text: "Decent estate overall, close to the offices on the Island which is handy.", daysAgoSubmitted: 8 },
    { residentIndex: 3, ratings: { security: 2, roads_flooding: 2 }, daysAgoSubmitted: 10 },
    { residentIndex: 4, ratings: { power: 4, water: 4, accessibility: 3 }, text: "Wutar lantarki tana zuwa sosai a nan, ruwan famfo ma yana samuwa kullum. Amma hanyoyin tafiya ba su da sauƙi ga tsofaffi.", daysAgoSubmitted: 12 },
    { residentIndex: 5, ratings: { power: 2, security: 2, water: 3 }, text: "We've had a few break-ins reported on the estate WhatsApp group recently.", daysAgoSubmitted: 14 },
    { residentIndex: 6, ratings: { power: 3, roads_flooding: 3, accessibility: 4 }, text: "Iná mànàmáná máa ń wá, ṣùgbọ́n kì í pẹ́. Ọ̀nà wa kò burú, àwọn àgbàlagbà sì lè rìn dé ọjà láìsí wàhálà.", daysAgoSubmitted: 16 },
    { residentIndex: 7, ratings: { water: 3, accessibility: 3 }, daysAgoSubmitted: 17 },
    { residentIndex: 8, ratings: { power: 4, water: 3, security: 2 }, daysAgoSubmitted: 20 },
    { residentIndex: 9, ratings: { power: 3, security: 3, accessibility: 3 }, daysAgoSubmitted: 22 },
    { residentIndex: 10, ratings: { power: 3, water: 4, roads_flooding: 2 }, text: "Roads flood badly right at the estate gate whenever it rains hard.", daysAgoSubmitted: 25 },
    { residentIndex: 11, ratings: { security: 2, power: 4 }, text: "Light dey stay well for here, but security no good at all. Dem don rob people for our street two times this month.", daysAgoSubmitted: 28 },
    { residentIndex: 12, ratings: { power: 3, water: 3, security: 2, accessibility: 4 }, text: "Ọ dị mfe ịga ahịa na ụlọ ọgwụ site n'ebe a. Mana anyị anaghị enwe udo n'abalị n'ihi ndị ohi.", daysAgoSubmitted: 30 },
    { residentIndex: 13, ratings: { power: 4, roads_flooding: 3 }, text: "Wuta tana nan kusan kullum. Titin yana da kyau, amma idan ruwan sama ya yi yawa sai ruwa ya cika shi.", daysAgoSubmitted: 33 },
    { residentIndex: 14, ratings: { security: 3, water: 4, power: 3 }, text: "Quiet, established neighbourhood — one of the better parts of Lagos for power supply.", daysAgoSubmitted: 35 },
  ],
  "Lekki Phase 1": [
    { residentIndex: 1, ratings: { power: 4, water: 4, security: 4, accessibility: 3 }, text: "Great place to live if you can handle the traffic on the Lekki-Epe Expressway.", daysAgoSubmitted: 4 },
    { residentIndex: 2, ratings: { power: 4, security: 4, roads_flooding: 3 }, text: "Iná mànàmáná dúró dáadáa, ààbò sì dára nínú estate wa. Ṣùgbọ́n omi máa ń kún ọ̀nà kan nígbà òjò.", daysAgoSubmitted: 9 },
    { residentIndex: 3, ratings: { power: 3, water: 4, accessibility: 4 }, text: "Water dey run every day, we no dey buy water again. Light dey try small. E easy to waka reach market and bus stop.", daysAgoSubmitted: 15 },
    { residentIndex: 4, ratings: { security: 4, power: 4, water: 3 }, text: "Private estate security is solid — haven't had any issues in two years here.", daysAgoSubmitted: 21 },
    { residentIndex: 5, ratings: { power: 3, roads_flooding: 2, accessibility: 3 }, text: "Flooding near the lekki-epe expressway side is a real problem in the rainy season.", daysAgoSubmitted: 27 },
    { residentIndex: 6, ratings: { power: 4, water: 4, security: 3 }, daysAgoSubmitted: 40 },
  ],
  "Surulere": [
    { residentIndex: 7, ratings: { power: 5, water: 4, security: 4 }, text: "Central and lively, and power is more stable than most of the mainland.", daysAgoSubmitted: 6 },
    { residentIndex: 8, ratings: { power: 5, accessibility: 3, water: 3 }, text: "Ọkụ adịghị anyụ ebe a. Mmiri na-abịa mgbe ụfọdụ, ọ bụghị kwa ụbọchị.", daysAgoSubmitted: 19 },
    { residentIndex: 9, ratings: { security: 2, power: 4, roads_flooding: 3 }, text: "Night time no safe for this side at all, thief dey operate. Light sef dey constant, na only security be the wahala.", daysAgoSubmitted: 31 },
  ],
  "Yaba": [
    { residentIndex: 10, ratings: { power: 4, water: 1, roads_flooding: 2, accessibility: 3 }, text: "Water supply is basically nonexistent — everyone here relies on boreholes.", daysAgoSubmitted: 11 },
  ],
  "Mushin": [
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
  "Ajegunle": [
    { residentIndex: 1, ratings: { roads_flooding: 1, water: 2 }, text: "Every rainy season the drains overflow and water enters our houses. We wade through the flood to reach the main road.", daysAgoSubmitted: 3 },
    { residentIndex: 4, ratings: { roads_flooding: 2, power: 3 }, daysAgoSubmitted: 8 },
    { residentIndex: 6, ratings: { roads_flooding: 1, accessibility: 2 }, text: "Once rain start, flood go cover the whole street because the gutter don block. Old people no fit comot for house.", daysAgoSubmitted: 12 },
    { residentIndex: 7, ratings: { roads_flooding: 2, water: 1 }, text: "Public water hardly comes; most days we buy from water vendors.", daysAgoSubmitted: 16 },
    { residentIndex: 9, ratings: { roads_flooding: 1, security: 3 }, daysAgoSubmitted: 20 },
    { residentIndex: 10, ratings: { roads_flooding: 2, accessibility: 2 }, text: "The road to the market is full of potholes and floods after every heavy rain.", daysAgoSubmitted: 24 },
    { residentIndex: 12, ratings: { roads_flooding: 1, power: 2 }, daysAgoSubmitted: 29 },
    { residentIndex: 14, ratings: { roads_flooding: 2, water: 2, security: 3 }, daysAgoSubmitted: 36 },
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

  // Mushin's security flag and Ajegunle's roads/flooding flag genuinely
  // trigger from the data above (enough contributors, well under
  // FLAG_THRESHOLD), but a freshly-triggered flag only carries streak=1 —
  // not yet "persisted" long enough to be government-actionable
  // (MIN_WEEKS_PERSISTENT=4). Backdating these two flags simulates them
  // having been sampled by the weekly sweep for 5 and 4 consecutive weeks,
  // the only piece of this seed that fakes elapsed time rather than
  // deriving it from real data.
  for (const [name, aspect, weeks] of [["Mushin", "security", 5], ["Ajegunle", "roads_flooding", 4]] as const) {
    const updated = await prisma.flag.updateMany({
      where: { areaId: areaByName.get(name)!, aspect, resolved: false },
      data: { consecutiveWeeksBelowThreshold: weeks, triggeredAt: daysAgo(7) },
    });
    if (updated.count !== 1) throw new Error(`Expected a ${aspect} flag for ${name}`);
  }

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
