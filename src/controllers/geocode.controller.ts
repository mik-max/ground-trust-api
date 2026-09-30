import { Request, Response } from "express";
import { SERVICE_STATE_BOUNDS, isInServiceState } from "../config/constants";

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  address?: { state?: string };
}

// Proxied server-side rather than called directly from the browser:
// Nominatim's usage policy requires a real identifying User-Agent, which
// browser fetch/XHR can't set (the browser silences it), plus this gives us
// one place to rate-limit/cache if usage grows. Free, keyless — matches the
// project's "free options only" constraint (see project_credentials_status
// memory). Restricted to Lagos State, the scope of the study: Nominatim is
// bounded to the state's box, and results are then filtered by state name
// because the box also covers edges of Ogun State.
export async function searchLocations(req: Request, res: Response) {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 3) {
    return res.json({ results: [] });
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "ng");
  const b = SERVICE_STATE_BOUNDS;
  url.searchParams.set("viewbox", `${b.minLng},${b.maxLat},${b.maxLng},${b.minLat}`);
  url.searchParams.set("bounded", "1");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "10");

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
    const results = data
      .filter((r) => isInServiceState(r.address?.state))
      .slice(0, 6)
      .map((r) => ({
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
