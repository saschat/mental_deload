// Zürioberland Tourismus (zuerioberland.ch): experiences in the Zürcher
// Oberland. The WordPress API is open: it lists the experiences tagged
// "Familien" with their categories (topic, town, indoor/outdoor). Each page's
// JSON-LD TouristAttraction gives the coordinates; hikes only embed an
// Outdooractive map, so they are placed at their town. Restaurants, cafés and
// hotels are left out. The event calendar is a Guidle widget that loads its
// dates in the browser, so it is not read.

import type { Activity, Setting } from "../../src/core/activities.ts";
import { distanceKm } from "../../src/core/geo.ts";
import { isFresh, remember, reuse, type Context, type Source } from "./context.ts";
import { decodeEntities, inlineText, round } from "./text.ts";

const BASE = "https://www.zuerioberland.ch";
const API = `${BASE}/wp-json/wp/v2`;
/** "Geeignet für: Familien". */
const FAMILIES = 51;
/** Parent of the town categories ("Orte"). */
const TOWNS = 351;
/** Wetzikon, the middle of the Oberland; a geocoded name further out than RADIUS_KM is a namesake elsewhere. */
const OBERLAND: [number, number] = [47.3263, 8.7978];
const RADIUS_KM = 25;
const INDOOR = 70;
const OUTDOOR = 71;
const MAX_AGE_DAYS = 90;
const VERSION = 1;

/** Topic categories and the kind they give, in the order that names an experience listed under several. */
const KINDS: [number, string][] = [
  [291, "Animals"], // Tiere & Bauernhöfe
  [289, "Playground"], // Feuerstellen & Spielplätze
  [287, "Snow"], // Eis & Schnee
  [293, "Swimming"], // Wasser & Badis
  [280, "Museum"], // Museen
  [282, "Castle"], // Schlösser & Burgen
  [284, "Theatre"], // Theater & Tanz
  [277, "Museum"], // Kulturerbe & Industriekultur
  [978, "Museum"], // Kunst & Kultur: Familien
  [279, "Exhibition"], // Kunst
  [292, "Hike"], // Wandern
  [286, "Biking"], // Biken
  [288, "Nature"], // Natur & Bewegung: Familien
];
/** Bars, mountain inns, cafés, holiday homes, hotels, restaurants, delicatessen. */
const FOOD_AND_BEDS = new Set([264, 1106, 1105, 266, 267, 268, 269]);

export interface ZoExperience {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
  modified_gmt: string;
  categories: number[];
}

export interface ZoCategory {
  id: number;
  name: string;
  parent: number;
}

/** Coordinates from the page's TouristAttraction. */
export function parseGeo(html: string): [number, number] | null {
  const m = /"@type":\s*"TouristAttraction"[\s\S]*?"latitude":\s*([\d.]+),\s*"longitude":\s*([\d.]+)/.exec(html);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * Place names in the title of an experience without coordinates (the hikes):
 * "Naturrundweg Illnau–Agasul" → Illnau, Agasul. They beat the town category,
 * which some hikes carry wrongly.
 */
export function placeQueries(title: string): string[] {
  const names = (title.match(/\p{Lu}[\p{L}-]{3,}/gu) ?? []).filter((w) => !/(weg|pfad|wanderung|runde|trail|tour|erlebnis)$/i.test(w));
  return [...new Set(names)];
}

type Point = [number, number];
const km = (a: Point, b: Point) => distanceKm({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });

/**
 * Where a hike is, from the candidates for each name in its title: with two
 * names, the pair of namesakes closest together (Ottikon b. Kemptthal next to
 * First ZH, not Ottikon near Gossau); with one, its first candidate.
 */
export function pickPlace(lists: readonly Point[][]): Point | null {
  const found = lists.filter((l) => l.length);
  if (!found.length) return null;
  let best: { at: Point; d: number } | null = null;
  for (let i = 0; i < found.length; i++) {
    for (let j = i + 1; j < found.length; j++) {
      for (const a of found[i]) for (const b of found[j]) if (!best || km(a, b) < best.d) best = { at: a, d: km(a, b) };
    }
  }
  return best?.at ?? found[0][0];
}

interface SearchResponse {
  results?: { attrs?: { lat?: number; lon?: number } }[];
}

/** geo.admin.ch places for a name, within reach of the Oberland. */
async function candidates(ctx: Context, name: string): Promise<Point[]> {
  const params = new URLSearchParams({ searchText: name, type: "locations", sr: "4326", limit: "8" });
  try {
    const body = await ctx.http.json<SearchResponse>(`https://api3.geo.admin.ch/rest/services/api/SearchServer?${params}`);
    return (body.results ?? [])
      .map((r) => [r.attrs?.lat, r.attrs?.lon])
      .filter((p): p is Point => typeof p[0] === "number" && typeof p[1] === "number")
      .map(([lat, lng]): Point => [round(lat), round(lng)])
      .filter((p) => km(p, OBERLAND) <= RADIUS_KM);
  } catch {
    return [];
  }
}

/** Activity without coordinates, or null for places to eat and sleep. */
export function toActivity(e: ZoExperience, categories: ReadonlyMap<number, ZoCategory>): Omit<Activity, "lat" | "lng"> | null {
  const title = inlineText(decodeEntities(e.title.rendered));
  let kind = KINDS.find(([id]) => e.categories.includes(id))?.[1];
  if (!kind && e.categories.some((id) => FOOD_AND_BEDS.has(id))) return null;
  if (/restaurant|gasthaus|wirtschaft|beiz|bistro|café|cafe|kaffee/i.test(title)) return null;
  kind ??= /bowling|minigolf|escape/i.test(title) ? "Games" : "Outing";
  if (kind === "Snow" && /schlitt|rodel/i.test(title)) kind = "Sledding";
  if (kind === "Snow" && /eisbahn|eisfeld|schlittschuh/i.test(title)) kind = "Ice skating";
  if (kind === "Swimming" && !/bad\b|badi|schwimm|schwümbi/i.test(title)) kind = "Nature";
  const indoor = e.categories.includes(INDOOR);
  const outdoor = e.categories.includes(OUTDOOR);
  const setting: Setting | undefined = indoor && outdoor ? "mixed" : indoor ? "indoor" : outdoor ? "outdoor" : undefined;
  let months: number[] | undefined;
  if (kind === "Snow" || kind === "Sledding") months = [12, 1, 2, 3];
  else if (kind === "Swimming" && setting === "outdoor") months = [5, 6, 7, 8, 9];
  const town = e.categories.map((id) => categories.get(id)).find((c) => c?.parent === TOWNS);
  const tags = e.categories
    .filter((id) => KINDS.some(([k]) => k === id))
    .map((id) => categories.get(id)?.name)
    .filter((n): n is string => !!n && n !== "Familien")
    .map(decodeEntities);
  const activity: Omit<Activity, "lat" | "lng"> = {
    id: `zuerioberland:${e.slug}`,
    source: "zuerioberland",
    title,
    url: e.link,
    kind,
    setting,
    place: town ? decodeEntities(town.name) : undefined,
    months,
    tags: tags.length ? tags : undefined,
  };
  for (const k of Object.keys(activity) as (keyof typeof activity)[]) if (activity[k] === undefined) delete activity[k];
  return activity;
}

async function all<T>(ctx: Context, url: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await ctx.http.json<T[]>(`${url}${url.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

export const zuerioberland: Source = {
  id: "zuerioberland",
  name: "Zürioberland Tourismus",
  url: BASE,
  async run(ctx) {
    const categories = new Map((await all<ZoCategory>(ctx, `${API}/categories?_fields=id,name,parent`)).map((c) => [c.id, c]));
    const experiences = await all<ZoExperience>(
      ctx,
      `${API}/erlebnisse?categories=${FAMILIES}&_fields=id,slug,link,title,modified_gmt,categories`,
    );
    const out: Activity[] = [];
    let fetched = 0;
    for (const e of experiences) {
      const base = toActivity(e, categories);
      if (!base) continue;
      const page = ctx.state.pages[e.link];
      if (isFresh(page, e.modified_gmt, ctx.now, MAX_AGE_DAYS, VERSION)) {
        const kept = reuse(ctx, page!);
        // The listing is re-read every run, so its facts are current; only the coordinates are kept.
        if (kept) {
          out.push(...kept.map((a) => ({ ...base, lat: a.lat, lng: a.lng }) as Activity));
          continue;
        }
      }
      if (fetched >= ctx.maxPages) continue;
      fetched += 1;
      let at: [number, number] | null = null;
      try {
        at = parseGeo(await ctx.http.text(e.link));
      } catch (err) {
        ctx.log(`zuerioberland: ${(err as Error).message}`);
        continue;
      }
      if (!at) {
        const lists = [];
        for (const name of placeQueries(base.title)) lists.push(await candidates(ctx, name));
        at = pickPlace(lists) ?? (base.place ? await ctx.geocode(base.place) : null);
      }
      // Without coordinates the outing cannot be placed or sorted by distance.
      if (!at) {
        remember(ctx, e.link, e.modified_gmt, [], VERSION);
        continue;
      }
      const activity: Activity = { ...base, lat: at[0], lng: at[1] };
      remember(ctx, e.link, e.modified_gmt, [activity], VERSION);
      out.push(activity);
    }
    ctx.log(`zuerioberland: ${experiences.length} family experiences, fetched ${fetched} pages, ${out.length} activities`);
    return out;
  },
};
