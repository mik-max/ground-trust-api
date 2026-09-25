import "dotenv/config";
import prisma from "../src/config/prisma";
import { Prisma } from "../src/generated/prisma";
import { processReview } from "../src/services/nlp.service";

// Runs the NLP pipeline (translation + aspect/sentiment classification) on
// every review that has a comment but hasn't been processed yet, e.g. after
// seeding a fresh database. Safe to re-run: processed reviews are skipped.
async function main() {
  const reviews = await prisma.review.findMany({
    where: { nlpAspects: { equals: Prisma.AnyNull }, originalText: { not: null } },
    select: { id: true },
  });
  console.log(`Processing ${reviews.length} review(s)...`);

  let done = 0;
  for (const { id } of reviews) {
    await processReview(id);
    const r = await prisma.review.findUnique({ where: { id }, select: { nlpAspects: true } });
    if (r?.nlpAspects !== null) done++;
  }
  console.log(`Done: ${done}/${reviews.length} processed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
