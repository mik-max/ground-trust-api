// Imports the Lagos area directory (prisma/data/lagos-areas.csv) so residents
// can find their area and be the first to review it, instead of proposing it.
//
// Sources: INEC electoral wards from GRID3's "Nigeria Operational Ward
// Boundaries" (eHealth Africa and Proxy Logics, 2020; CC BY 4.0) and
// OpenStreetMap places and named estates (© OpenStreetMap contributors, ODbL).
// prisma/data/build_lagos_areas.py documents how the CSV was produced.
//
// Safe to run repeatedly: it only adds areas that don't exist yet and fills in
// the LGA of existing areas that have none. It never updates or deletes
// anything else.
import fs from "fs";
import path from "path";
import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();
const DATA = path.join(__dirname, "data");

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

const slug = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const SOURCE: Record<string, string> = { "INEC ward (GRID3)": "inec-ward", OpenStreetMap: "openstreetmap" };

async function main() {
  const rows = parseCsv(fs.readFileSync(path.join(DATA, "lagos-areas.csv"), "utf8"));
  const existingIds = new Set((await prisma.area.findMany({ select: { id: true } })).map((a) => a.id));

  const seen = new Set<string>();
  const toCreate = [];
  for (const r of rows) {
    let id = `lagos-${slug(r.lga)}-${slug(r.name)}`;
    for (let n = 2; seen.has(id); n++) id = `lagos-${slug(r.lga)}-${slug(r.name)}-${n}`;
    seen.add(id);
    if (existingIds.has(id)) continue;
    toCreate.push({
      id,
      name: r.name,
      city: r.lga,
      state: "Lagos",
      lga: r.lga,
      aliases: r.also_known_as || null,
      source: SOURCE[r.source] ?? r.source,
      kind: r.kind,
      geoCentroidLat: Number(r.latitude),
      geoCentroidLng: Number(r.longitude),
      geoRadiusMeters: Number(r.radius_m),
      status: "approved" as const,
    });
  }
  const created = toCreate.length ? (await prisma.area.createMany({ data: toCreate, skipDuplicates: true })).count : 0;

  let lgasFilled = 0;
  const lgaRows = parseCsv(fs.readFileSync(path.join(DATA, "existing-area-lgas.csv"), "utf8"));
  for (const r of lgaRows) {
    const res = await prisma.area.updateMany({ where: { id: r.id, lga: null }, data: { lga: r.lga } });
    lgasFilled += res.count;
  }

  console.log(`Areas in file: ${rows.length}. Added: ${created}. Already present: ${rows.length - toCreate.length}.`);
  console.log(`LGA filled in for ${lgasFilled} existing area(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
