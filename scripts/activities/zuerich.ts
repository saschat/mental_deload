// Zürich Tourism (zuerich.com): the open data API (CC BY-SA) lists places by
// category with coordinates and whether they are indoors or outdoors. We read
// the categories that suit families: nature, animals, walks, pools, sledding,
// children's museums, Christmas markets. The API has no page links, so each
// place is matched to its German page in the sitemap by its name.

import type { Activity, Setting } from "../../src/core/activities.ts";
import { distanceKm, ZURICH_HB } from "../../src/core/geo.ts";
import type { Context, Source } from "./context.ts";
import { parseSitemap } from "./context.ts";
import { htmlToText, iso, parseChf } from "./text.ts";

const BASE = "https://www.zuerich.com";
const API = `${BASE}/en/api/v2/data`;
/** The categories also cover the Alps; keep what makes a day trip. */
const MAX_KM = 80;

/**
 * API categories and the kind they give, in the order that names a place
 * listed under several. Some only count when the name agrees: a lake listed
 * for swimming or skating, or a mountain listed for sledding, is a place to go
 * all year.
 */
export const CATEGORIES: { id: number; kind: string; name?: RegExp }[] = [
  { id: 418, kind: "Market" }, // Weihnachtsmarkt
  { id: 161, kind: "Animals" }, // Zoo & Tiere
  { id: 153, kind: "Sledding", name: /rodel|schlitt|winter/i }, // Schlitteln & Rodeln
  { id: 156, kind: "Ice skating", name: /eis|ice/i }, // Eislaufen
  { id: 141, kind: "Swimming", name: /bad\b|badi|bäder|pool|schwimm|lido|strand|therm/i }, // Schwimmen
  { id: 10004, kind: "Museum" }, // Kinderfreundliche Museen
  { id: 182, kind: "Museum" }, // Naturwissenschaften & Technik
  { id: 145, kind: "Climbing", name: /kletter|boulder|seilpark|climb/i }, // Klettern
  { id: 144, kind: "Adventure park" }, // Sommer Rodeln
  { id: 138, kind: "Hike" }, // Wanderung
  { id: 137, kind: "Hike" }, // Spaziergang
  { id: 88, kind: "Aussichtspunkt" }, // Aussichtspunkte
  { id: 151, kind: "Sports" }, // Pedalos
  { id: 99, kind: "Nature" }, // Natur, with mountains, lakes, parks
];

/** API record fields we read. Texts come in four languages. */
export interface ZtPlace {
  identifier: string;
  "@type"?: string;
  name: Record<string, string>;
  geoCoordinates?: { latitude: number | string; longitude: number | string } | null;
  address?: { addressLocality?: string; url?: string } | null;
  price?: Record<string, string | null> | null;
  specialOpeningHoursSpecification?: Record<string, string | null> | null;
  place?: string[] | null;
}

const GERMAN_MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
const DATE = /(\d{1,2})\.\s*([a-zä]+)\s+(\d{4})/;

function germanDate(text: string): string | null {
  const m = DATE.exec(text.toLowerCase());
  const month = m ? GERMAN_MONTHS.indexOf(m[2]) + 1 : 0;
  return m && month ? iso(Number(m[3]), month, Number(m[1])) : null;
}

/**
 * Months a place is open, from "Saisonbedingt geschlossen von Mittwoch,
 * 24. Dezember 2025 bis Donnerstag, 19. November 2026": every month the
 * closure covers in full is out. Undefined when nothing says.
 */
export function openMonths(note: string | null | undefined): number[] | undefined {
  const m = /geschlossen von (.+?) bis (.+)/i.exec(htmlToText(note ?? ""));
  const from = m && germanDate(m[1]);
  const to = m && germanDate(m[2]);
  if (!from || !to || to < from) return undefined;
  const closed = new Set<number>();
  let y = Number(from.slice(0, 4));
  let mo = Number(from.slice(5, 7));
  for (let i = 0; i < 24; i++) {
    const first = iso(y, mo, 1);
    const last = iso(y, mo, new Date(Date.UTC(y, mo, 0)).getUTCDate());
    if (first > to) break;
    if (from <= first && to >= last) closed.add(mo);
    mo = (mo % 12) + 1;
    if (mo === 1) y += 1;
  }
  if (!closed.size || closed.size >= 12) return undefined;
  return [...Array(12).keys()].map((i) => i + 1).filter((month) => !closed.has(month));
}

const WINTER = [12, 1, 2, 3];
const SUMMER = [5, 6, 7, 8, 9, 10];

function settingOf(place: readonly string[] | null | undefined): Setting | undefined {
  const indoor = place?.includes("Indoors");
  const outdoor = place?.includes("Outdoors");
  if (indoor && outdoor) return "mixed";
  return indoor ? "indoor" : outdoor ? "outdoor" : undefined;
}

/** Page path segment zuerich.com builds from a German name: "Juckerhof Seegräben" → "juckerhof-seegraeben". */
export function pageSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Activity for a place, or null for ones that are not a family outing or are too far. */
export function toActivity(p: ZtPlace, categories: readonly number[], pages: ReadonlyMap<string, string>): Activity | null {
  const lat = Number(p.geoCoordinates?.latitude);
  const lng = Number(p.geoCoordinates?.longitude);
  if (!lat || !lng || distanceKm({ lat, lng }, ZURICH_HB) > MAX_KM) return null;
  if (/Restaurant|DaySpa|Church/.test(p["@type"] ?? "")) return null;
  const note = htmlToText(p.specialOpeningHoursSpecification?.de ?? "");
  const title = (p.name.de || p.name.en).trim();
  let kind = CATEGORIES.find((c) => categories.includes(c.id) && (!c.name || c.name.test(title)))?.kind ?? "Nature";
  // Closed for now and not a seasonal market: probably gone.
  if (/vorübergehend geschlossen/i.test(note) && kind !== "Market") return null;
  const setting = settingOf(p.place);
  if (kind === "Nature" && /langlauf|\bski|snowboard/i.test(title)) kind = "Snow";
  let months = openMonths(note);
  if (kind === "Market") months = [11, 12];
  else if (!months && /im winter/i.test(title)) months = WINTER;
  else if (!months && /im sommer/i.test(title)) months = SUMMER;
  else if (!months && (kind === "Sledding" || kind === "Snow")) months = WINTER;
  else if (!months && kind === "Ice skating" && setting !== "indoor") months = [11, ...WINTER];
  else if (!months && kind === "Swimming" && setting === "outdoor") months = [5, 6, 7, 8, 9];
  const activity: Activity = {
    id: `zuerich:${p.identifier}`,
    source: "zuerich",
    title,
    url: pages.get(pageSlug(p.name.de ?? "")) ?? p.address?.url ?? `${BASE}/de/besuchen`,
    kind,
    setting,
    lat,
    lng,
    place: p.address?.addressLocality?.trim() || undefined,
    months,
    costChf: parseChf(p.price?.de ?? undefined),
  };
  for (const k of Object.keys(activity) as (keyof Activity)[]) if (activity[k] === undefined) delete activity[k];
  return activity;
}

export const zuerich: Source = {
  id: "zuerich",
  name: "Zürich Tourismus",
  url: BASE,
  async run(ctx: Context) {
    const pages = new Map<string, string>();
    for (const { loc } of parseSitemap(await ctx.http.text(`${BASE}/sitemap.xml`))) {
      const m = /^https:\/\/www\.zuerich\.com\/de\/besuchen\/[^/]+\/([^/?#]+)$/.exec(loc);
      if (m && !pages.has(m[1])) pages.set(m[1], loc);
    }
    const places = new Map<string, { place: ZtPlace; categories: number[] }>();
    for (const { id } of CATEGORIES) {
      const list = await ctx.http.json<ZtPlace[]>(`${API}?id=${id}`);
      for (const place of Array.isArray(list) ? list : []) {
        const hit = places.get(place.identifier) ?? { place, categories: [] };
        hit.categories.push(id);
        places.set(place.identifier, hit);
      }
    }
    const out: Activity[] = [];
    for (const { place, categories } of places.values()) {
      const a = toActivity(place, categories, pages);
      if (a) out.push(a);
    }
    ctx.log(`zuerich: ${places.size} places in ${CATEGORIES.length} categories, ${out.length} kept`);
    return out;
  },
};
