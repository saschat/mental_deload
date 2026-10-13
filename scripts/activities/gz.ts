// Zürcher Gemeinschaftszentren (gz-zh.ch): one WordPress multisite for all
// community centres. Each centre has an "angebote" sitemap; each offer page
// lists its dates, cost and registration, and tags its audience
// (zielgruppen-kinder …) on the <article>. Centre coordinates come from the
// city's open-data WFS.

import type { Activity, ActivityDate } from "../../src/core/activities.ts";
import { isFresh, parseSitemap, remember, reuse, type Context, type Source } from "./context.ts";
import { between, compactDates, htmlToText, inlineText, iso, parseAges, parseChf, slugOf } from "./text.ts";

const BASE = "https://gz-zh.ch";
/** Offer pages roll their date lists forward, so re-read them monthly even without edits. */
const MAX_AGE_DAYS = 28;
/** 2: centre as feed. */
const VERSION = 2;
const WFS =
  "https://www.ogd.stadt-zuerich.ch/wfs/geoportal/Gemeinschaftszentrum?SERVICE=WFS&VERSION=1.1.0&REQUEST=GetFeature&TYPENAME=poi_gemeinschaftszentrum_view&OUTPUTFORMAT=GeoJSON&SRSNAME=EPSG:4326";

const MONTHS_DE: Record<string, number> = {
  jan: 1,
  feb: 2,
  mär: 3,
  mar: 3,
  apr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  okt: 10,
  nov: 11,
  dez: 12,
};

export interface GzOffer {
  title: string;
  audiences: string[];
  sparten: string[];
  dates: ActivityDate[];
  fields: Record<string, string>;
  /** Whole body text, for ages written anywhere in it. */
  text: string;
}

const time = (s: string | undefined) => s?.replace(/\s*Uhr\s*$/i, "").replace(/\s*[-–]\s*/, "–").trim() || undefined;

export function parseOffer(html: string): GzOffer {
  const article = /<article[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";
  const audiences = [...article.matchAll(/zielgruppen-([a-z0-9-]+)/g)].map((m) => m[1]);
  const sparten = [...article.matchAll(/sparte-([a-z0-9-]+)/g)].map((m) => m[1]);
  const title = inlineText(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "");

  const dates: ActivityDate[] = [];
  // "Alle Daten anzeigen" popover: <td>Mi.</td><td>21.10.2026</td><td>14:00–17:00 Uhr</td>
  const popover = /data-content="(<table[\s\S]*?<\/table>)"/.exec(html)?.[1] ?? "";
  for (const m of popover.matchAll(/<td>(\d{2})\.(\d{2})\.(\d{4})<\/td>\s*<td>([^<]*)<\/td>/g)) {
    dates.push({ start: iso(Number(m[3]), Number(m[2]), Number(m[1])), time: time(m[4]) });
  }
  if (!dates.length) {
    // Single date in the header: "So., 1. Nov. 2026 <br> 14:00–14:40 Uhr".
    const head = between(html, /<div class="place-time">/, /<\/div>/) ?? "";
    const m = /(\d{1,2})\.\s*([A-Za-zäÄ]{3})[a-zä]*\.?\s*(\d{4})\s*(?:<br\s*\/?>\s*([\d:–-]+\s*(?:–|-)\s*[\d:]+))?/.exec(head);
    const month = m ? MONTHS_DE[m[2].toLowerCase()] : undefined;
    if (m && month) dates.push({ start: iso(Number(m[3]), month, Number(m[1])), time: time(m[4]) });
  }

  const fields: Record<string, string> = {};
  const content = between(html, /<div class="entry-content/, /social-bookmark-icons/) ?? "";
  for (const m of content.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3|<\/div>\s*<\/div>\s*<\/div>|$)/g)) {
    fields[inlineText(m[1])] = inlineText(m[2]);
  }
  return { title, audiences, sparten, dates: compactDates(dates), fields, text: htmlToText(content) };
}

export function isForKids(offer: Pick<GzOffer, "audiences" | "sparten" | "title">): boolean {
  if (/für erwachsene|\bab 60\b|senior/i.test(offer.title)) return false;
  const a = new Set(offer.audiences);
  return (
    a.has("kinder") || a.has("jugendliche") || offer.sparten.includes("ferienangebote") || (a.has("familien") && !a.has("seniorinnen"))
  );
}

const KIND: [string, string][] = [
  ["ferienangebote", "Holiday camp"],
  ["theater", "Theatre"],
  ["musik", "Music"],
  ["werken-gestalten", "Crafts"],
  ["bewegung-tanz", "Movement"],
  ["spiel", "Games"],
  ["sprachen-literatur", "Stories"],
  ["film", "Film"],
  ["maerkte-boersen", "Market"],
  ["treffs-gruppen", "Meet-up"],
  ["events", "Event"],
];

export function toActivity(url: string, centre: string, offer: GzOffer): Omit<Activity, "lat" | "lng"> | null {
  if (!offer.title || !offer.dates.length || !isForKids(offer)) return null;
  const f = offer.fields;
  const ages = parseAges([f["Besondere Hinweise"], offer.title, offer.text].filter(Boolean).join(" · "));
  const registration = f["Anmeldung"] ?? f["Anmelden"] ?? "";
  const activity: Omit<Activity, "lat" | "lng"> = {
    id: `gz:${centre}/${slugOf(url)}`,
    source: "gz",
    feed: centre,
    title: offer.title,
    url,
    kind: KIND.find(([s]) => offer.sparten.includes(s))?.[1] ?? "Offer",
    place: centreName(centre),
    ageMin: ages.min,
    ageMax: ages.max,
    costChf: parseChf(f["Kosten"]),
    dates: offer.dates,
    booking: /einfach vorbei|ohne anmeldung|keine anmeldung|nicht (erforderlich|nötig)/i.test(registration)
      ? "drop-in"
      : registration || "Anmelden" in f
        ? "required"
        : undefined,
    tags: offer.sparten,
  };
  for (const k of Object.keys(activity) as (keyof typeof activity)[]) if (activity[k] === undefined) delete activity[k];
  return activity;
}

/** "gz-witikon" → "GZ Witikon". */
export function centreName(slug: string): string {
  return slug.replace(/^gz-/, "GZ ").replace(/-(\w)/g, " $1").replace(/\b([a-zäöü])/g, (c) => c.toUpperCase()).replace(/^Gz/, "GZ");
}

interface WfsFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { mail?: string | null; name?: string | null };
}

async function centreCoordinates(ctx: Context): Promise<Map<string, [number, number]>> {
  const out = new Map<string, [number, number]>();
  try {
    const body = await ctx.http.json<{ features?: WfsFeature[] }>(WFS);
    for (const f of body.features ?? []) {
      const slug = /^(gz-[a-z-]+)@gz-zh\.ch$/.exec(f.properties?.mail ?? "")?.[1];
      const c = f.geometry?.coordinates;
      // The main site comes before "Standort …" annexes.
      if (slug && c && (!out.has(slug) || !/standort/i.test(f.properties?.name ?? ""))) out.set(slug, [c[1], c[0]]);
    }
  } catch (e) {
    ctx.log(`gz: centre coordinates unavailable: ${(e as Error).message}`);
  }
  return out;
}

export const gz: Source = {
  id: "gz",
  name: "Zürcher Gemeinschaftszentren",
  url: BASE,
  feedName: centreName,
  async run(ctx) {
    const robots = await ctx.http.text(`${BASE}/robots.txt`);
    const centres = [...robots.matchAll(/Sitemap:\s*(https:\/\/gz-zh\.ch\/(gz-[a-z-]+)\/sitemap_index\.xml)/g)].map((m) => ({
      sitemap: m[1],
      slug: m[2],
    }));
    const coords = await centreCoordinates(ctx);
    const out: Activity[] = [];
    let fetched = 0;
    for (const centre of centres) {
      const index = parseSitemap(await ctx.http.text(centre.sitemap));
      const offers = index.find((s) => /angebote-sitemap\.xml$/.test(s.loc));
      if (!offers) continue;
      const pages = parseSitemap(await ctx.http.text(offers.loc));
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
          ctx.log(`gz: ${(e as Error).message}`);
          continue;
        }
        const offer = parseOffer(html);
        const base = toActivity(loc, centre.slug, offer);
        if (!base) {
          remember(ctx, loc, lastmod, [], VERSION);
          continue;
        }
        // Offers held elsewhere name a street address; the rest happen at the centre.
        const ort = offer.fields["Ort"] ?? "";
        const elsewhere = /\d{4}\s+\p{L}/u.test(ort) && !new RegExp(centreName(centre.slug), "i").test(ort);
        const at = (elsewhere ? await ctx.geocode(ort.replace(/^[^,]*?(?=\S+(?:strasse|weg|gasse|platz))/i, "")) : null) ?? coords.get(centre.slug);
        const activity: Activity = at ? { ...base, lat: at[0], lng: at[1] } : base;
        remember(ctx, loc, lastmod, [activity], VERSION);
        out.push(activity);
      }
      ctx.log(`gz: ${centre.slug} done, ${out.length} kids' offers so far`);
    }
    ctx.log(`gz: fetched ${fetched} pages, ${out.length} kids' offers`);
    return out;
  },
};
