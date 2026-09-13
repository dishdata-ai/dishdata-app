import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/geocode?q=<address>
 *
 * Turns a street address into lat/lng for the Clock-in Location setting —
 * so an admin can set up geofencing from their desk instead of needing to
 * physically stand at the restaurant (that's what "Use my current location"
 * is for). Proxies OpenStreetMap's Nominatim: it's free and needs no API
 * key, but its usage policy requires a real User-Agent identifying the app
 * and rate-limits at ~1 req/s, both fine for an occasional Settings lookup —
 * this must run server-side since Nominatim expects that header, which a
 * browser fetch can't set itself.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "Enter an address to look up." }, { status: 400 });

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": "DishData/1.0 (restaurant-ops app; geocode lookup)" } });
  } catch {
    return NextResponse.json({ error: "Couldn't reach the address lookup service." }, { status: 502 });
  }
  if (!res.ok) return NextResponse.json({ error: "Address lookup failed." }, { status: 502 });

  const results = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (results.length === 0) {
    return NextResponse.json({ error: "No match for that address — try adding the city or postcode." }, { status: 404 });
  }
  const { lat, lon, display_name } = results[0];
  return NextResponse.json({ lat: +lat, lng: +lon, displayName: display_name });
}
