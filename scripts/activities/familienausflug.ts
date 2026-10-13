// familienausflug.info: a large DACH directory of family outings. Region
// listing pages ("…/ausflug-mit-kindern/zürich/witterung-regenwetter?page=2")
// give candidate entries; each entry page has JSON-LD coordinates and
// "data-property" blocks for age, stroller, weather and type. Only the
// rainy-day and indoor listings around Zürich are read.

import type { Activity, Setting } from "../../src/core/activities.ts";
import { distanceKm, ZURICH_HB } from "../../src/core/geo.ts";
import { isFresh, remember, reuse, type Source } from "./context.ts";
import { decodeEntities, parseMonths, round, slugOf } from "./text.ts";

const BASE = "https://familienausflug.info";
const MAX_AGE_DAYS = 60;
const VERSION = 1;
const MAX_KM = 60;
const MAX_LIST_PAGES = 8;

const REGIONS = [
  "zürich",
  "zürich-stadt",
  "winterthur",
  "uster",
  "horgen",
  "dietikon",
  "bülach",
  "zug",
  "aargau",
  "schwyz",
  "thurgau",
  "schaffhausen",
  "st-gallen",
];
const LISTINGS = [
  "witterung-regenwetter",
  "ausflugsziel-ist-ein-indoorspielplatz",
  "ausflugsziel-ist-ein-museum",
  "sportanlage-kletterhalle",
  "bad-therme",
];

export function listingSlugs(html: string): string[] {
  return [...new Set([...html.matchAll(/href="\/ausflugsziel\/([^"?#]+)"/g)].map((m) => m[1]))];
}

/** Values of each `data-property` block, e.g. { AlterDerKinder: ["6 bis 10 Jahre", …] }. */
export function properties(html: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const blocks = html.split(/data-property="/).slice(1);
  for (const block of blocks) {
    const name = block.slice(0, block.indexOf('"'));
    const values = [...block.matchAll(new RegExp(`class="available ${name}_\\d+">\\s*([^<]+?)\\s*<`, "g"))].map((m) =>
      decodeEntities(m[1]).trim(),
    );
    if (values.length && !out[name]) out[name] = [...new Set(values)];
  }
  return out;
}

interface JsonLdPlace {
  name?: string;
  address?: { addressLocality?: string; addressCountry?: string };
  geo?: { latitude?: string | number; longitude?: string | number };
}

export function parseEntry(html: string): { ld: JsonLdPlace | null; props: Record<string, string[]>; season?: string } {
  let ld: JsonLdPlace | null = null;
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const node = JSON.parse(m[1]) as JsonLdPlace & { "@type"?: string | string[] };
      if (node.geo) {
        ld = node;
        break;
      }
    } catch {
      // Some blocks are not valid JSON; skip them.
    }
  }
  const season = /class="epsot021">([^<]+)</.exec(html)?.[1];
  return { ld, props: properties(html), season: season ? decodeEntities(season) : undefined };
}

const KINDS: [RegExp, string][] = [
  [/indoorspielplatz/i, "Indoor play"],
  [/kletterhalle|kletterpark/i, "Climbing"],
  [/\bbad\b|therme/i, "Swimming"],
  [/museum|kulturelle/i, "Museum"],
  [/zoo|tierpark/i, "Animals"],
  [/escape/i, "Escape room"],
  [/freizeitpark/i, "Theme park"],
  [/schaubetrieb/i, "Factory visit"],
  [/sportanlage/i, "Sports"],
];

export function ageRange(values: string[] | undefined): { min?: number; max?: number } {
  if (!values?.length) return {};
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    const m = /(\d+)\s*bis\s*(\d+)/.exec(v);
    if (m) {
      min = Math.min(min, Number(m[1]));
      max = Math.max(max, Number(m[2]));
    } else if (/über\s*(\d+)/.test(v)) {
      min = Math.min(min, Number(/über\s*(\d+)/.exec(v)![1]));
      max = Infinity;
    } else if (/jugendliche/i.test(v)) {
      min = Math.min(min, 12);
      max = Infinity;
    }
  }
  return { min: Number.isFinite(min) ? min : undefined, max: Number.isFinite(max) ? max : undefined };
}

export function toActivity(slug: string, entry: ReturnType<typeof parseEntry>): Activity | null {
  const { ld, props } = entry;
  const lat = Number(ld?.geo?.latitude);
  const lng = Number(ld?.geo?.longitude);
  if (!ld?.name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (ld.address?.addressCountry && ld.address.addressCountry !== "CH") return null;
  if (distanceKm(ZURICH_HB, { lat, lng }) > MAX_KM) return null;
  const weather = props.Witterung ?? [];
  const rain = weather.some((w) => /regen/i.test(w));
  const sun = weather.some((w) => /schön/i.test(w));
  const setting: Setting | undefined = rain && sun ? "mixed" : rain ? "indoor" : sun ? "outdoor" : undefined;
  const types = (props.KategorieIchBin ?? []).join(" · ");
  const kind = KINDS.find(([re]) => re.test(types))?.[1] ?? (types.split(" · ")[0]?.replace(/^eine?\s+/, "") || "Outing");
  const pram = (props.Kinderwagen ?? []).join(" ");
  const ages = ageRange(props.AlterDerKinder);
  const activity: Activity = {
    id: `familienausflug:${slug}`,
    source: "familienausflug",
    title: decodeEntities(ld.name).trim(),
    url: `${BASE}/ausflugsziel/${slug}`,
    kind,
    setting,
    lat: round(lat),
    lng: round(lng),
    place: ld.address?.addressLocality,
    stroller: /vollständig|größtenteils|grossteils|großteils/i.test(pram) ? true : /wenig|nicht/i.test(pram) ? false : undefined,
    months: parseMonths(entry.season),
    ageMin: ages.min,
    ageMax: ages.max,
  };
  for (const k of Object.keys(activity) as (keyof Activity)[]) if (activity[k] === undefined) delete activity[k];
  return activity;
}

export const familienausflug: Source = {
  id: "familienausflug",
  name: "familienausflug.info",
  url: BASE,
  async run(ctx) {
    const slugs = new Set<string>();
    for (const region of REGIONS) {
      for (const listing of LISTINGS) {
        const url = `${BASE}/ausflug-mit-kindern/${encodeURIComponent(region)}/${listing}`;
        for (let page = 1; page <= MAX_LIST_PAGES; page++) {
          let html: string;
          try {
            html = await ctx.http.text(page === 1 ? url : `${url}?page=${page}`);
          } catch {
            break; // Not every region has every listing.
          }
          const before = slugs.size;
          for (const s of listingSlugs(html)) slugs.add(s);
          if (slugs.size === before) break;
        }
      }
    }
    ctx.log(`familienausflug: ${slugs.size} candidate entries`);
    const out: Activity[] = [];
    let fetched = 0;
    for (const slug of slugs) {
      const url = `${BASE}/ausflugsziel/${slug}`;
      const page = ctx.state.pages[url];
      if (isFresh(page, undefined, ctx.now, MAX_AGE_DAYS, VERSION)) {
        const kept = reuse(ctx, page!);
        if (kept) {
          out.push(...kept);
          continue;
        }
      }
      if (fetched >= ctx.maxPages) continue;
      fetched += 1;
      try {
        const a = toActivity(slugOf(url), parseEntry(await ctx.http.text(url)));
        remember(ctx, url, undefined, a ? [a] : [], VERSION);
        if (a) out.push(a);
      } catch (e) {
        ctx.log(`familienausflug: ${(e as Error).message}`);
      }
    }
    ctx.log(`familienausflug: fetched ${fetched}, ${out.length} places near Zürich`);
    return out;
  },
};
