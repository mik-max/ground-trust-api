import { Request, Response } from "express";

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

// Proxied server-side rather than called directly from the browser:
// Nominatim's usage policy requires a real identifying User-Agent, which
// browser fetch/XHR can't set (the browser silences it), plus this gives us
// one place to rate-limit/cache if usage grows. Free, keyless — matches the
// project's "free options only" constraint (see project_credentials_status
// memory). Restricted to Nigeria since every Area this app knows about is
// Nigerian.
export async function searchLocations(req: Request, res: Response) {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 3) {
    return res.json({ results: [] });
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "ng");
  url.searchParams.set("limit", "6");

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "GroundTruth-FYP/1.0 (final-year-project; non-commercial)",
        "Accept-Language": "en",
      },
    });
    if (!response.ok) {
      return res.json({ results: [] });
    }
    const data = (await response.json()) as NominatimResult[];
    const results = data.map((r) => ({
      label: r.display_name,
      lat: Number(r.lat),
      lng: Number(r.lon),
    }));
    return res.json({ results });
  } catch (err) {
    console.error("[geocode] Nominatim request failed:", err);
    return res.json({ results: [] });
  }
}
