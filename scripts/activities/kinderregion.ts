// Kinderregion (kinderregion.ch): a hand-written guide to family outings in
// the Zürich region, Lake Zürich, Winterthur, Zug, Schwyz, Glarus, Baden and
// Liechtenstein. The sitemap lists every place; each page names its town,
// carries its coordinates and links its main list ("Schlitteln",
// "Interaktive Museen" …), which gives the kind. Hotels, hostels, campsites,
// restaurants and ice-cream places are left out. The age and season filters
// load in the browser and are not read; the season comes from the list.

import type { Activity } from "../../src/core/activities.ts";
import { isFresh, parseSitemap, remember, reuse, type Source } from "./context.ts";
import { between, decodeEntities, htmlToText, inlineText, parseAges, parseChf, round, slugOf } from "./text.ts";

const BASE = "https://kinderregion.ch";
const SITEMAPS = [`${BASE}/orte-sitemap.xml`, `${BASE}/orte-sitemap2.xml`];
/** Pages carry a lastmod; re-read now and then for list moves the lastmod misses. */
const MAX_AGE_DAYS = 90;
const VERSION = 1;

const WINTER = [12, 1, 2, 3];
const SUMMER = [5, 6, 7, 8, 9];

/** Main list → kind. Lists not here (birthday venues …) fall back to "Outing". */
const KINDS: Record<string, string> = {
  abenteuerspielplatz: "Playground",
  "indoor-spielhallen": "Indoor play",
  "indoor-action": "Indoor play",
  "outdoor-action": "Adventure park",
  seilparks: "Adventure park",
  freizeitanlagen: "Theme park",
  "escape-games": "Escape room",
  minigolf: "Games",
  tiere: "Animals",
  erlebnispfade: "Hike",
  "familien-trails": "Hike",
  "hoerspielwege-und-geschichten": "Hike",
  naturlehrpfade: "Hike",
  rundwanderungen: "Hike",
  winterwandern: "Hike",
  berge: "Mountain",
  berghuetten: "Mountain",
  naturschutzgebiete: "Nature",
  "seen-der-region": "Nature",
  "grillplaetze-am-wasser": "Nature",
  "see-und-flussbaeder": "Outdoor pool",
  freibaeder: "Outdoor pool",
  hallenbaeder: "Indoor pool",
  wassersport: "Sports",
  schlitteln: "Sledding",
  nachtschlitteln: "Sledding",
  "skifahren-mit-kindern": "Snow",
  langlaufen: "Snow",
  "spezielle-ausfluege-winter": "Snow",
  schlittschuhlaufen: "Ice skating",
  velotouren: "Biking",
  pumptracks: "Biking",
  trottinettes: "Biking",
  "bouldern-klettern": "Climbing",
  "forschen-und-entdecken": "Museum",
  "museen-geschichte": "Museum",
  "kunstmuseen-mit-kindern": "Museum",
  "erlebnisse-im-dunkeln": "Exhibition",
  "burgen-und-schloesser": "Castle",
  manufakturen: "Factory visit",
  familientheater: "Theatre",
  kino: "Film",
  "kinderfreundliche-schifffahrten": "Trip",
  "kinder-stadtfuehrungen": "Trip",
  weihnachtsmarkt: "Market",
};

/** Places to sleep and eat. */
const LEFT_OUT = new Set([
  "familienhotels",
  "jugendherbergen",
  "campingplatz",
  "spezielle-uebernachtungen",
  "restaurants-mit-spielecken",
  "restaurants-mit-spielplaetzen",
  "brunch-mit-kindern",
  "glace-mit-kindern",
]);

const MONTHS: Record<string, number[]> = {
  schlitteln: WINTER,
  nachtschlitteln: WINTER,
  "skifahren-mit-kindern": WINTER,
  langlaufen: WINTER,
  "spezielle-ausfluege-winter": WINTER,
  schlittschuhlaufen: WINTER,
  winterwandern: WINTER,
  "see-und-flussbaeder": SUMMER,
  freibaeder: SUMMER,
  weihnachtsmarkt: [11, 12],
};

export interface KrPage {
  title: string;
  /** Slug of the main list in the breadcrumb, "schlitteln". */
  list?: string;
  place?: string;
  lat?: number;
  lng?: number;
  /** The highlights box: duration, ages, length … */
  highlights: string;
  prices: string;
}

export function parsePage(html: string): KrPage {
  const crumb = between(html, /<div class="backlink">/, /<div class="breadcrumb_current">/) ?? "";
  const geo = /data-lat="([\d.]+)"\s+data-long="([\d.]+)"/.exec(html);
  const prices = /<span class="title_big">\s*Preise\s*<\/span>[\s\S]*?<div class="inside_content">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  return {
    title: inlineText(decodeEntities(/<h1>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "")),
    list: /\/de\/liste\/([a-z0-9-]+)\//.exec(crumb)?.[1],
    place: inlineText(decodeEntities(/<div class="location_detail_name">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "")) || undefined,
    lat: geo ? round(Number(geo[1])) : undefined,
    lng: geo ? round(Number(geo[2])) : undefined,
    highlights: htmlToText(/<div class="highlights_box">([\s\S]*?)<\/div>\s*(?:<!--[^>]*-->\s*)?<div class="mobile_hide_content/.exec(html)?.[1] ?? "").replace(/\n+/g, " · "),
    prices: inlineText(decodeEntities(prices)),
  };
}

/** The index entry for one place, or null for places to sleep and eat and pages without coordinates. */
export function toActivity(url: string, page: KrPage): Activity | null {
  if (!page.title || page.lat === undefined || page.lng === undefined) return null;
  if (page.list && LEFT_OUT.has(page.list)) return null;
  if (!page.list && /restaurant|hotel|hostel|camping|wirtschaft|gasthaus|naturfreundehaus|naturfruendehuus/i.test(page.title)) return null;
  let months = page.list ? MONTHS[page.list] : undefined;
  if (!months && /\bim winter\b|\bwinter$/i.test(page.title)) months = WINTER;
  // Only lines about children: "E-Fun mit Bob (ab 18 Jahren)" is an extra for grown-ups.
  const ages = parseAges(
    page.highlights
      .split(" · ")
      .filter((l) => /kind|geeignet|familie|alter/i.test(l))
      .join(" · "),
  );
  const activity: Activity = {
    id: `kinderregion:${slugOf(url)}`,
    source: "kinderregion",
    title: page.title,
    url,
    kind: (page.list && KINDS[page.list]) || "Outing",
    lat: page.lat,
    lng: page.lng,
    place: page.place,
    months,
    ageMin: ages.min !== undefined && ages.min <= 14 ? ages.min : undefined,
    costChf: parseChf(page.prices),
    tags: page.list ? [page.list] : undefined,
  };
  for (const k of Object.keys(activity) as (keyof Activity)[]) if (activity[k] === undefined) delete activity[k];
  return activity;
}

export const kinderregion: Source = {
  id: "kinderregion",
  name: "Kinderregion",
  url: BASE,
  async run(ctx) {
    const pages = [];
    for (const sitemap of SITEMAPS) pages.push(...parseSitemap(await ctx.http.text(sitemap)).filter((p) => p.loc.includes("/de/besuchen/")));
    const out: Activity[] = [];
    let fetched = 0;
    for (const { loc, lastmod } of pages) {
      const page = ctx.state.pages[loc];
      if (isFresh(page, lastmod, ctx.now, MAX_AGE_DAYS, VERSION)) {
        const kept = reuse(ctx, page!);
        if (kept) {
          out.push(...kept);
          continue;
        }
      }
      if (fetched >= ctx.maxPages) continue;
      fetched += 1;
      let html: string;
      try {
        html = await ctx.http.text(loc);
      } catch (e) {
        ctx.log(`kinderregion: ${(e as Error).message}`);
        continue;
      }
      const activity = toActivity(loc, parsePage(html));
      remember(ctx, loc, lastmod, activity ? [activity] : [], VERSION);
      if (activity) out.push(activity);
    }
    ctx.log(`kinderregion: ${pages.length} places, fetched ${fetched} pages, ${out.length} activities`);
    return out;
  },
};
