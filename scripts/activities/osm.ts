// OpenStreetMap through Overpass: indoor playgrounds, trampoline parks,
// climbing halls, ice rinks and pools within reach of Zürich. Mostly the
// bad-weather places that blogs skip.

import type { Activity, Setting } from "../../src/core/activities.ts";
import { distanceKm, ZURICH_HB } from "../../src/core/geo.ts";
import type { Source } from "./context.ts";
import { parseMonths, round } from "./text.ts";

// The main instance answers 504 within seconds when all its slots are busy;
// the mirror carries the same data but is slower.
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const RADIUS_KM = 45;
const ROUNDS = 4;

// One small query per kind of place: a busy server is more likely to take
// several quick ones than one big one, and a failed kind can be retried alone.
export const FILTERS = [
  '["leisure"="indoor_play"]',
  '["leisure"="trampoline_park"]',
  '["sport"="climbing"]["leisure"~"^(sports_centre|sports_hall)$"]',
  '["leisure"="ice_rink"]',
  '["leisure"="water_park"]',
  '["leisure"="sports_centre"]["sport"="swimming"]',
];

/** A bounding box around Zürich; much cheaper for Overpass than "around". toActivity trims it to the radius. */
export function overpassQuery(filter: string, center = ZURICH_HB, radiusKm = RADIUS_KM): string {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((center.lat * Math.PI) / 180));
  const bbox = [center.lat - dLat, center.lng - dLng, center.lat + dLat, center.lng + dLng].map((n) => n.toFixed(3)).join(",");
  return `[out:json][timeout:60][bbox:${bbox}];nwr${filter}["name"];out center tags;`;
}

export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const SUMMER = [5, 6, 7, 8, 9];
const ICE = [10, 11, 12, 1, 2, 3];

function classify(tags: Record<string, string>): { kind: string; setting: Setting; months?: number[] } | null {
  const name = tags.name ?? "";
  const indoor = tags.indoor === "yes" || tags.covered === "yes" || /halle|hall|indoor/i.test(name);
  if (tags.leisure === "indoor_play") return { kind: "Indoor play", setting: "indoor" };
  if (tags.leisure === "trampoline_park") return { kind: "Trampoline park", setting: "indoor" };
  if (tags.sport === "climbing") return { kind: "Climbing hall", setting: "indoor" };
  if (tags.leisure === "ice_rink") {
    return indoor ? { kind: "Ice skating", setting: "indoor" } : { kind: "Ice skating", setting: "outdoor", months: ICE };
  }
  if (tags.leisure === "water_park" || tags.sport === "swimming") {
    if (/hallenbad|hallen-|thermal|therme|alpamare|wellness/i.test(name) || indoor) return { kind: "Indoor pool", setting: "indoor" };
    if (/freibad|strandbad|seebad|badi|flussbad|schwimmbad|badesee|badeplatz|badestelle|weiher|rheinbad|freiluft/i.test(name)) return { kind: "Outdoor pool", setting: "outdoor", months: SUMMER };
    return { kind: "Pool", setting: "mixed" };
  }
  return null;
}

/** OSM min_age / max_age tags: plain whole years. */
function age(tag: string | undefined): number | undefined {
  return tag && /^\d{1,2}$/.test(tag.trim()) ? Number(tag) : undefined;
}

export function toActivity(el: OsmElement): Activity | null {
  const tags = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!tags.name || lat === undefined || lng === undefined) return null;
  if (distanceKm(ZURICH_HB, { lat, lng }) > RADIUS_KM) return null;
  if (tags.access === "private" || tags.access === "customers" || tags.disused === "yes") return null;
  // School pools and climbing walls are not open to the public.
  if (/schulschwimm|lehrschwimm|kantonsschule|\bkanti\b|schulhaus/i.test(tags.name)) return null;
  const c = classify(tags);
  if (!c) return null;
  const website = tags.website ?? tags["contact:website"];
  const activity: Activity = {
    id: `osm:${el.type}/${el.id}`,
    source: "osm",
    title: tags.name,
    url: website && /^https?:\/\//.test(website) ? website : `https://www.openstreetmap.org/${el.type}/${el.id}`,
    kind: c.kind,
    setting: c.setting,
    lat: round(lat),
    lng: round(lng),
    place: tags["addr:city"],
    months: parseMonths(tags.opening_hours?.match(/[A-Z][a-z]{2}\s*-\s*[A-Z][a-z]{2}(?=\s)/)?.[0]) ?? c.months,
    ageMin: age(tags.min_age),
    ageMax: age(tags.max_age),
  };
  for (const k of Object.keys(activity) as (keyof Activity)[]) if (activity[k] === undefined) delete activity[k];
  return activity;
}

export const osm: Source = {
  id: "osm",
  name: "OpenStreetMap",
  url: "https://www.openstreetmap.org",
  async run(ctx) {
    const elements: OsmElement[] = [];
    let pending = [...FILTERS];
    let lastError: unknown;
    for (let round = 1; round <= ROUNDS && pending.length; round++) {
      if (round > 1) {
        ctx.log(`osm: ${pending.length} queries left, waiting before round ${round}`);
        await new Promise((r) => setTimeout(r, 30_000 * (round - 1)));
      }
      const failed: string[] = [];
      for (const filter of pending) {
        let done = false;
        for (const endpoint of OVERPASS) {
          try {
            // Overpass answers 406 to "Accept: application/json", so read it as text.
            const text = await ctx.http.text(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ data: overpassQuery(filter) }).toString(),
            });
            elements.push(...((JSON.parse(text) as { elements?: OsmElement[] }).elements ?? []));
            done = true;
            break;
          } catch (e) {
            lastError = e;
            ctx.log(`osm: ${filter} on ${new URL(endpoint).host} failed: ${(e as Error).message}`);
          }
        }
        if (!done) failed.push(filter);
      }
      pending = failed;
    }
    if (pending.length === FILTERS.length) throw lastError;
    const seen = new Set<string>();
    const out: Activity[] = [];
    for (const el of elements) {
      const a = toActivity(el);
      // Pools are often mapped twice (area and building); keep one per name and town.
      const key = `${a?.title}|${a?.place ?? Math.round((a?.lat ?? 0) * 100)}`;
      if (!a || seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
    if (pending.length) {
      // Some kinds never came through: keep last run's places so they do not vanish.
      const ids = new Set(out.map((a) => a.id));
      const kept = [...ctx.previous.values()].filter((a) => a.source === "osm" && !ids.has(a.id));
      out.push(...kept);
      ctx.log(`osm: ${pending.length} queries failed, kept ${kept.length} previous places`);
    }
    ctx.log(`osm: ${elements.length} elements, ${out.length} places`);
    return out;
  },
};
