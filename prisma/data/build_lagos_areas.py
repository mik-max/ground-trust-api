"""Build a list of Lagos areas from INEC wards (via GRID3) and OpenStreetMap places.

Inputs (same folder): grid3_wards.geojson, grid3_lgas.geojson, osm_places.json, existing.txt
Output: lagos_areas.csv and a summary on stdout.
"""
import csv, json, math, re, collections, os

D = os.path.dirname(os.path.abspath(__file__))
LGA_DISPLAY = {
    "Ajeromi/Ifelodun": "Ajeromi-Ifelodun", "Amuwo Odofin": "Amuwo-Odofin", "Eti Osa": "Eti-Osa",
    "Ibeju Lekki": "Ibeju-Lekki", "Ifako/Ijaye": "Ifako-Ijaiye", "Oshodi/Isolo": "Oshodi-Isolo",
}
lga_name = lambda n: LGA_DISPLAY.get(n.strip(), n.strip())


def rings_of(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    return geom["coordinates"]  # MultiPolygon: list of polygons (each a list of rings)


def point_in_ring(x, y, ring):
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def point_in_geom(lng, lat, geom):
    for poly in rings_of(geom):
        if point_in_ring(lng, lat, poly[0]) and not any(point_in_ring(lng, lat, h) for h in poly[1:]):
            return True
    return False


def area_and_centroid(geom):
    """Area in km² and area-weighted centroid (lat, lng) using a local flat projection."""
    total, cx, cy = 0.0, 0.0, 0.0
    for poly in rings_of(geom):
        for k, ring in enumerate(poly):
            lat0 = ring[0][1]
            kx, ky = 111.32 * math.cos(math.radians(lat0)), 110.57
            pts = [(x * kx, y * ky) for x, y in ring]
            a = sx = sy = 0.0
            for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
                c = x1 * y2 - x2 * y1
                a += c; sx += (x1 + x2) * c; sy += (y1 + y2) * c
            a /= 2
            if abs(a) < 1e-12:
                continue
            sign = 1 if k == 0 else -1
            total += sign * abs(a)
            cx += sign * abs(a) * (sx / (6 * a)) / kx
            cy += sign * abs(a) * (sy / (6 * a)) / ky
    return total, (cy / total, cx / total)


def km(a, b):
    dy = (a[0] - b[0]) * 110.57
    dx = (a[1] - b[1]) * 111.32 * math.cos(math.radians(a[0]))
    return math.hypot(dx, dy)


def norm(s):
    s = s.lower().replace("&", " and ")
    s = re.sub(r"\b(estate|scheme|phase|gra|layout|town|ward|village)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def tidy(name):
    name = re.sub(r"\s*/\s*", " / ", name.strip())
    return re.sub(r"\s+", " ", name)


lgas = json.load(open(f"{D}/grid3_lgas.geojson"))["features"]
def lga_of(lat, lng):
    for f in lgas:
        if point_in_geom(lng, lat, f["geometry"]):
            return lga_name(f["properties"]["lganame"])
    return None

# ---------- 1. wards ----------
wards = json.load(open(f"{D}/grid3_wards.geojson"))["features"]
groups = collections.defaultdict(list)
for f in wards:
    raw = tidy(f["properties"]["wardname"])
    base = re.sub(r"\s+(\d+|I{1,3}|IV|V|VI{0,3})$", "", raw)  # "Orimedu 3" -> "Orimedu"
    groups[(base, lga_name(f["properties"]["lganame"]))].append((raw, f["geometry"]))

areas = []
for (base, lga), parts in groups.items():
    tot, cy, cx = 0.0, 0.0, 0.0
    for raw, g in parts:
        a, (la, ln) = area_and_centroid(g)
        tot += a; cy += a * la; cx += a * ln
    lat, lng = cy / tot, cx / tot
    radius = int(min(3000, max(400, math.sqrt(tot / math.pi) * 1000)) // 50 * 50)
    aliases = sorted({p.strip() for p in re.split(r"\s*/\s*", base) if p.strip()} - {base})
    areas.append(dict(name=base, aliases=aliases, lga=lga, lat=round(lat, 5), lng=round(lng, 5), radius=radius,
                      source="INEC ward (GRID3)", kind="ward", wards=len(parts)))

# ---------- 2. existing areas ----------
existing = []
for line in open(f"{D}/existing.txt"):
    i, n, la, ln, r, st = line.strip().split("|")
    existing.append(dict(id=i, name=n, lat=float(la), lng=float(ln)))

# ---------- 3. OpenStreetMap ----------
osm = json.load(open(f"{D}/osm_places.json"))["elements"] + json.load(open(f"{D}/osm_cities.json"))["elements"]
RADIUS = {"city": 3000, "town": 2500, "suburb": 1500, "village": 1000, "neighbourhood": 800, "quarter": 800, "estate": 600}
NOT_A_NEIGHBOURHOOD = re.compile(r"residence of|\bclub\b|\bcomplex\b|resettlement camp", re.I)
dropped = collections.Counter(); merged_into_ward = merged_into_existing = 0
added_osm = []
for e in osm:
    t = e["tags"]; kind = t.get("place") or ("estate" if t.get("landuse") == "residential" else None)
    if kind not in RADIUS:
        dropped[kind or "other"] += 1; continue
    c = (e.get("lat"), e.get("lon")) if "lat" in e else (e["center"]["lat"], e["center"]["lon"])
    lga = lga_of(c[0], c[1])
    if not lga:
        dropped["outside Lagos"] += 1; continue
    name = tidy(t["name"].split(",")[0]).rstrip(". ")  # "Royal Gardens Estate, Ajah, Lekki, Lagos." -> "Royal Gardens Estate"
    nn = norm(name)
    if NOT_A_NEIGHBOURHOOD.search(name):
        dropped["not a neighbourhood"] += 1; continue
    if not nn:
        dropped["no usable name"] += 1; continue
    # matches one of the existing live areas -> skip
    if any(norm(x["name"]) == nn and km((x["lat"], x["lng"]), c) < 3 for x in existing):
        merged_into_existing += 1; continue
    # matches a ward (by name or one of its parts) nearby -> becomes a search alias of that ward
    hit = None
    for a in areas:
        if a["kind"] == "ward" and km((a["lat"], a["lng"]), c) < 4 and (
            norm(a["name"]) == nn or any(norm(p) == nn for p in a["aliases"])):
            hit = a; break
    if hit:
        merged_into_ward += 1; continue
    # duplicate of another OSM place already added
    if any(norm(a["name"]) == nn and km((a["lat"], a["lng"]), c) < 1.5 for a in added_osm):
        dropped["duplicate"] += 1; continue
    a = dict(name=name, aliases=[], lga=lga, lat=round(c[0], 5), lng=round(c[1], 5), radius=RADIUS[kind],
             source="OpenStreetMap", kind=kind, wards=0)
    added_osm.append(a)
areas += added_osm

# ---------- 4. wards that duplicate an existing live area ----------
final = []
skipped_existing_ward = 0
for a in areas:
    if any(norm(x["name"]) in {norm(a["name"])} | {norm(p) for p in a["aliases"]} and km((x["lat"], x["lng"]), (a["lat"], a["lng"])) < 3 for x in existing):
        skipped_existing_ward += 1; continue
    final.append(a)

final.sort(key=lambda a: (a["lga"], a["name"].lower()))
with open(f"{D}/lagos_areas.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["name", "also_known_as", "lga", "latitude", "longitude", "radius_m", "kind", "source"])
    for a in final:
        w.writerow([a["name"], "; ".join(a["aliases"]), a["lga"], a["lat"], a["lng"], a["radius"], a["kind"], a["source"]])

print("wards ->", sum(1 for a in final if a["kind"] == "ward"), "areas (from 377 wards; numbered wards merged)")
print("OpenStreetMap ->", len(added_osm), "new areas;", merged_into_ward, "matched a ward;", merged_into_existing, "matched an existing area;", dict(dropped))
print("skipped as duplicates of existing live areas:", skipped_existing_ward)
print("TOTAL new areas:", len(final))
print("by LGA:", dict(collections.Counter(a["lga"] for a in final)))
print("by kind:", dict(collections.Counter(a["kind"] for a in final)))
