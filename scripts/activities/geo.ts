// Geocoding through the federal geo.admin.ch search (free, no key, Swiss
// addresses and place names) and elevation through Open-Meteo. Both are
// cached in the crawl state so weekly runs only look up new places.

import type { Activity } from "../../src/core/activities.ts";
import { distanceKm, ZURICH_HB } from "../../src/core/geo.ts";
import type { CrawlState } from "./context.ts";
import type { Http } from "./http.ts";
import { round } from "./text.ts";

interface SearchResponse {
  results?: { attrs?: { lat?: number; lon?: number; label?: string } }[];
}

export function makeGeocoder(http: Http, state: CrawlState) {
  return async function geocode(query: string): Promise<[number, number] | null> {
    const key = query.trim().replace(/\s+/g, " ");
    if (!key) return null;
    if (key in state.geocode) return state.geocode[key];
    const params = new URLSearchParams({ searchText: key, type: "locations", sr: "4326", limit: "1" });
    let hit: [number, number] | null = null;
    try {
      const body = await http.json<SearchResponse>(`https://api3.geo.admin.ch/rest/services/api/SearchServer?${params}`);
      const attrs = body.results?.[0]?.attrs;
      if (attrs && typeof attrs.lat === "number" && typeof attrs.lon === "number") hit = [round(attrs.lat), round(attrs.lon)];
    } catch {
      return null; // Not cached, so a transient failure is retried next run.
    }
    state.geocode[key] = hit;
    return hit;
  };
}

const elevationKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

/** Mont Blanc; anything higher is a typo on the source page. */
const HIGHEST_ALPS_M = 4810;

/** Fill in distance from Zürich HB and, where missing, site elevation. */
export async function enrich(http: Http, state: CrawlState, activities: Activity[], log: (msg: string) => void) {
  const missing = new Map<string, { lat: number; lng: number }>();
  for (const a of activities) {
    if (a.altitudeM !== undefined && a.altitudeM > HIGHEST_ALPS_M) delete a.altitudeM;
    if (a.lat === undefined || a.lng === undefined) continue;
    a.distanceKm = Math.round(distanceKm(ZURICH_HB, { lat: a.lat, lng: a.lng }) * 10) / 10;
    const key = elevationKey(a.lat, a.lng);
    if (a.altitudeM === undefined && !(key in state.elevation)) missing.set(key, { lat: a.lat, lng: a.lng });
  }
  const points = [...missing.entries()];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    const lat = chunk.map(([, p]) => p.lat.toFixed(4)).join(",");
    const lng = chunk.map(([, p]) => p.lng.toFixed(4)).join(",");
    try {
      const body = await http.json<{ elevation?: number[] }>(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`);
      chunk.forEach(([key], j) => {
        const e = body.elevation?.[j];
        if (typeof e === "number" && Number.isFinite(e)) state.elevation[key] = Math.round(e);
      });
    } catch (e) {
      log(`elevation lookup failed: ${(e as Error).message}`);
    }
  }
  for (const a of activities) {
    if (a.lat === undefined || a.lng === undefined || a.altitudeM !== undefined) continue;
    const e = state.elevation[elevationKey(a.lat, a.lng)];
    if (e !== undefined) a.altitudeM = e;
  }
}

/** Coordinates in Google Maps links and "46°56’47.7″N 8°41’11.0″E" notations. */
export function parseCoordinates(html: string): [number, number] | null {
  const pin = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(html);
  if (pin) return [Number(pin[1]), Number(pin[2])];
  const at = /google\.[a-z.]+\/maps\/[^"'\s]*@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(html);
  if (at) return [Number(at[1]), Number(at[2])];
  const dms =
    /(\d{1,2})\s*°\s*(\d{1,2})\s*['’′]\s*(\d{1,2}(?:\.\d+)?)\s*(?:["″”]|&#8243;|&quot;)?\s*N[\s,]+(\d{1,2})\s*°\s*(\d{1,2})\s*['’′]\s*(\d{1,2}(?:\.\d+)?)\s*(?:["″”]|&#8243;|&quot;)?\s*E/.exec(
      html,
    );
  if (dms) {
    const lat = Number(dms[1]) + Number(dms[2]) / 60 + Number(dms[3]) / 3600;
    const lng = Number(dms[4]) + Number(dms[5]) / 60 + Number(dms[6]) / 3600;
    return [round(lat), round(lng)];
  }
  const place = /google\.[a-z.]+\/maps\/place\/(\d{1,2})%C2%B0(\d{1,2})'(\d{1,2}(?:\.\d+)?)%22N\+(\d{1,2})%C2%B0(\d{1,2})'(\d{1,2}(?:\.\d+)?)%22E/i.exec(
    html,
  );
  if (place) {
    const lat = Number(place[1]) + Number(place[2]) / 60 + Number(place[3]) / 3600;
    const lng = Number(place[4]) + Number(place[5]) / 60 + Number(place[6]) / 3600;
    return [round(lat), round(lng)];
  }
  return null;
}
