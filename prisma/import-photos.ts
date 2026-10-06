// Imports curated area photos (prisma/data/area-photos.csv) into Cloudinary
// and the AreaPhoto table, approved and credited per each photo's licence.
//
// Every curated photo must be verifiably of the area it's attached to: they
// come from Wikimedia Commons photos whose recorded location falls inside
// the area's boundary, checked by eye before being added to the CSV.
//
// Safe to run repeatedly: a photo already imported (same area + source file)
// is skipped. It never deletes anything.
import "dotenv/config";
import fs from "fs";
import path from "path";
import { PrismaClient } from "../src/generated/prisma";
import { uploadAreaPhoto } from "../src/config/cloudinary";

const prisma = new PrismaClient();
const CSV = path.join(__dirname, "data", "area-photos.csv");

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ""])));
}

// Wikimedia asks for an identifying user agent, so the photo is fetched
// here and the bytes uploaded, rather than letting Cloudinary fetch it.
// It also rate-limits, so downloads are spaced out and retried with backoff.
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function download(url: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await pause(attempt === 0 ? 3000 : attempt * 15000);
    const res = await fetch(url, { headers: { "User-Agent": "GroundTrust-photo-import/1.0 (github.com/mik-max/ground-trust)" } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status !== 429 && res.status < 500) throw new Error(`Couldn't download ${url}: ${res.status}`);
  }
  throw new Error(`Couldn't download ${url}: still rate-limited after 5 attempts`);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

async function main() {
  const rows = parseCsv(fs.readFileSync(CSV, "utf8"));
  let added = 0;
  let skipped = 0;
  for (const r of rows) {
    const area = await prisma.area.findUnique({ where: { id: r.area_id }, select: { id: true, name: true } });
    if (!area) {
      console.warn(`Skipping ${r.area_id}: no such area`);
      skipped++;
      continue;
    }
    const publicIdName = `${area.id}--${slug(r.source_key)}`;
    const existing = await prisma.areaPhoto.findFirst({ where: { areaId: area.id, publicId: { endsWith: `/${publicIdName}` } } });
    if (existing) {
      skipped++;
      continue;
    }
    const uploaded = await uploadAreaPhoto(await download(r.image_url), publicIdName);
    const isCover = r.cover === "yes";
    if (isCover) await prisma.areaPhoto.updateMany({ where: { areaId: area.id, isCover: true }, data: { isCover: false } });
    await prisma.areaPhoto.create({
      data: {
        areaId: area.id,
        publicId: uploaded.publicId,
        width: uploaded.width,
        height: uploaded.height,
        source: "curated",
        status: "approved",
        isCover,
        credit: r.credit || null,
        creditUrl: r.credit_url || null,
        license: r.license || null,
        licenseUrl: r.license_url || null,
        reviewedAt: new Date(),
      },
    });
    added++;
    console.log(`Added ${area.name}: ${r.source_key}${isCover ? " (cover)" : ""}`);
  }
  console.log(`Photos in file: ${rows.length}. Added: ${added}. Skipped: ${skipped}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
