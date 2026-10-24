// freizeit.ch (loisirs.ch in German): outings and events across Switzerland.
// The REST API sits behind Cloudflare, but the region listings and pages are
// open (robots.txt asks for one request per second). We list the Zürich region
// and its neighbours, then read each page: its data layer names the
// categories, the calendar block holds event dates and prices, and the map
// block the coordinates. Sitemap dates tell which pages changed.

import type { Activity, ActivityDate } from "../../src/core/activities.ts";
import { distanceKm, ZURICH_HB } from "../../src/core/geo.ts";
import { isFresh, parseSitemap, remember, reuse, type Context, type Source } from "./context.ts";
import { compactDates, decodeEntities, htmlToText, inlineText, iso, parseChf, slugOf } from "./text.ts";

const BASE = "https://www.freizeit.ch";
/** Regions within a day trip of Zürich. */
const REGIONS = ["zuerich", "zug", "schwyz", "aargau", "st-gallen", "thurgau", "schaffhausen", "luzern", "glarus"];
/** Places, events, walks and playgrounds; not news, dossiers or ski resorts. */
const TYPES = new Set(["activite", "agenda", "balade", "place_de_jeux"]);
/** Region listings also carry sponsored places from all over Switzerland. */
const MAX_KM = 80;
/** Pages are re-read when the sitemap says they changed, or after this long. */
const MAX_AGE_DAYS = 30;
const VERSION = 1;

export interface ListingCard {
  url: string;
  type: string;
}

/** Cards of one region listing page and the number of its last page. */
export function parseListing(html: string): { cards: ListingCard[]; lastPage: number } {
  const cards: ListingCard[] = [];
  const re = /<article class="card card--typed">\s*<a class="[^"]*"\s+href="([^"]+)"\s+data-gtm-contentid="\d+"\s+data-gtm-post-type="([^"]+)"/g;
  for (const m of html.matchAll(re)) cards.push({ url: m[1], type: m[2] });
  const pages = [...html.matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1]));
  return { cards, lastPage: Math.max(1, ...pages) };
}

export interface FzPage {
  title: string;
  /** "Activite", "Agenda" … */
  section?: string;
  /** freizeit.ch categories, the canton left out. */
  categories: string[];
  canton?: string;
  city?: string;
  lat?: number;
  lng?: number;
  /** Lines of the calendar's opening-times block (events: one date per line). */
  schedule: string[];
  /** Price list entries (key, value); empty when prices are free text. */
  tariffs: [string, string][];
  /** All of the calendar block as text, for free-text prices. */
  calendarText: string;
  /** Event range from the page's JSON-LD, the fallback for dates. */
  eventStart?: string;
  eventEnd?: string;
}

function blocks(calendar: string): { heading: string; html: string }[] {
  return [...calendar.matchAll(/<div class="data-container">\s*<h2>([\s\S]*?)<\/h2>([\s\S]*?)(?=<div class="data-container">|<\/section>|$)/g)].map(
    (m) => ({ heading: inlineText(m[1]), html: m[2] }),
  );
}

export function parsePage(html: string): FzPage {
  const layer = /dataLayer\.push\((\{[\s\S]*?\})\);/.exec(html);
  let data: Record<string, unknown> = {};
  try {
    data = layer ? (JSON.parse(layer[1]) as Record<string, unknown>) : {};
  } catch {
    // Not the page-info push; fields stay unknown.
  }
  const canton = typeof data.canton === "string" ? data.canton : undefined;
  const categories = String(data.pageCategory ?? "")
    .split(" - ")
    .map((c) => decodeEntities(c).trim())
    .filter((c) => c && c !== canton);
  const title = inlineText(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "");
  const lat = Number(/data-center-lat="([\d.]+)"/.exec(html)?.[1]);
  const lng = Number(/data-center-lng="([\d.]+)"/.exec(html)?.[1]);
  const start = html.indexOf('<section id="calendar"');
  const calendar = start >= 0 ? html.slice(start, html.indexOf("</section>", start) + 10) : "";
  const opening = blocks(calendar).find((b) => /öffnungszeiten/i.test(b.heading));
  const schedule = opening ? [...opening.html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => inlineText(m[1])).filter(Boolean) : [];
  const tariffs = [...calendar.matchAll(/<span class="key">([\s\S]*?)<\/span>\s*<span class="value">([\s\S]*?)<\/span>/g)].map(
    (m) => [inlineText(m[1]), inlineText(m[2])] as [string, string],
  );
  const ld = /"@type":\s*"Event"[\s\S]*?"startDate":\s*"(\d{4}-\d{2}-\d{2})[^"]*",\s*"endDate":\s*"(\d{4}-\d{2}-\d{2})/.exec(html);
  return {
    title,
    section: typeof data.pageSection === "string" ? data.pageSection : undefined,
    categories,
    canton,
    city: typeof data.city === "string" ? data.city : undefined,
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
    schedule,
    tariffs,
    calendarText: htmlToText(calendar),
    eventStart: ld?.[1],
    eventEnd: ld?.[2],
  };
}

const MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
const month = (name: string | undefined) => (name ? MONTHS.indexOf(name.toLowerCase()) + 1 : 0);

/**
 * Event dates from the opening-times lines: "31 Oktober 2026", "Von 29 bis
 * 31 Oktober 2026", "Von 30 Oktober bis 1 November 2026", each optionally
 * followed by "samstag von 16h00 bis 22h30".
 */
export function parseSchedule(lines: readonly string[]): ActivityDate[] {
  const out: ActivityDate[] = [];
  for (const line of lines) {
    const single = /^(\d{1,2})\.? ([a-zä]+) (\d{4})$/i.exec(line);
    const range = /^von (\d{1,2})\.?(?: ([a-zä]+)(?: (\d{4}))?)? bis (\d{1,2})\.? ([a-zä]+) (\d{4})$/i.exec(line);
    const time = /(\d{1,2})h(\d{2}) bis (\d{1,2})h(\d{2})/.exec(line);
    if (single && month(single[2])) {
      out.push({ start: iso(Number(single[3]), month(single[2]), Number(single[1])) });
    } else if (range && month(range[5])) {
      const endMonth = month(range[5]);
      const endYear = Number(range[6]);
      const startMonth = month(range[2]) || endMonth;
      const startYear = range[3] ? Number(range[3]) : startMonth > endMonth ? endYear - 1 : endYear;
      const start = iso(startYear, startMonth, Number(range[1]));
      const end = iso(endYear, endMonth, Number(range[4]));
      out.push(end > start ? { start, end } : { start });
    } else if (time && out.length && !out[out.length - 1].time) {
      out[out.length - 1].time = `${time[1].padStart(2, "0")}:${time[2]}–${time[3].padStart(2, "0")}:${time[4]}`;
    }
  }
  return compactDates(out);
}

/** Lowest children's price from the price list, else from the free text. */
export function childPrice(page: Pick<FzPage, "tariffs" | "calendarText">): number | undefined {
  const kids = page.tariffs.filter(([key]) => /kind|kids|familie/i.test(key) && !/erwachsen/i.test(key));
  const prices = kids.map(([, value]) => parseChf(/\d/.test(value) ? `CHF ${value.replace(/chf/i, "")}` : value)).filter((p) => p !== undefined);
  if (prices.length) return Math.min(...prices);
  if (page.tariffs.length) return parseChf(page.tariffs.map(([k, v]) => `${k} ${v}`).join("\n"));
  const text = /Preise\n([\s\S]*?)(?:\nÖffnungszeiten|$)/.exec(page.calendarText)?.[1];
  return parseChf(text);
}

/** Categories that name the kind, in order. Events check the event kinds first. */
const EVENT_KINDS: [RegExp, string][] = [
  [/halloween|fasnacht|ostern|^feste$|festivals|festspiele/i, "Event"],
  [/märkte|flohm/i, "Market"],
  [/zirkus/i, "Circus"],
  [/puppen|märchen|theater/i, "Theatre"],
  [/kino/i, "Film"],
  [/musik/i, "Music"],
  [/basteln|kunst$|handwerk|kochen|kleinkinder|wissenschaft/i, "Workshop"],
];
const PLACE_KINDS: [RegExp, string][] = [
  [/bauernh|agrotour|^zoo$|tropen|aquarien|pferde|hunde|beobachtung|ornitholog/i, "Animals"],
  [/spielplätze/i, "Playground"],
  [/vergnügungsparks|freizeitzentren/i, "Theme park"],
  [/wasserparks|schwimmbäder|seebäder|thermalbäder/i, "Swimming"],
  [/seilparks|seilrutsche|rodeln|labyrinthe|trottinett|freifall/i, "Adventure park"],
  [/schlitteln|snowtubing/i, "Sledding"],
  [/schlittschuh/i, "Ice skating"],
  [/ski|langlauf|schneeschuh|wintersport/i, "Snow"],
  [/museen|museum|wissenschaft/i, "Museum"],
  [/schlösser|historische/i, "Castle"],
  [/klettern/i, "Climbing"],
  [/minigolf|bowling|lasergame|escape|^spiele$/i, "Games"],
  [/mit schiff|städte/i, "Trip"],
  [/wanderungen|zu fuss|lehrpfade|trekking|urban/i, "Hike"],
  [/velotour|mountainbike/i, "Biking"],
  [/schluchten|höhlen|naturereignisse|gärten|staudämme|picknick/i, "Nature"],
  [/wassersport|sportzentren/i, "Sports"],
];
/** Categories for grown-ups; such entries stay out unless the title speaks of children or families. */
const GROWN_UP =
  /nachtleben|degustation|spa & wellness|massagen|gesundheit|kosmetik|mode|sprachen|golf|messen|gourmet|brunch|shopping|einkaufszentrum|hotels|b&b|ferienwohnungen|jugendherbergen|berghütten|bungee|paintball|humor|tanzen|yoga|fitness|wettkämpfe|luftsport|freeride|skitouren|silvester|kunstgalerien|bibliotheken|begegnung|konzerte/i;
const GROWN_UP_TITLE = /\bbar\b|apéro|degustation|wein|whisky|party|kaufleuten/i;
const FOR_KIDS = /kind|famil|kids|knirps|baby|eltern|jugend/i;
const SEASONS: [RegExp, number[]][] = [
  [/frühling/i, [3, 4, 5]],
  [/sommer/i, [6, 7, 8]],
  [/herbst/i, [9, 10, 11]],
  [/winter/i, [12, 1, 2]],
];
/** Labels that say nothing about the outing: generic ones and regions (cantons). */
const NOISE =
  /^(teambildung|wochenend ideen|andere veranstaltungen|veranstaltungen|events|zürich|bern|luzern|uri|schwyz|obwalden|nidwalden|glarus|zug|freiburg|solothurn|basel.*|schaffhausen|appenzell.*|st\. gallen|graubünden|aargau|thurgau|tessin|waadt|wallis|neuenburg|genf|jura|ausland)$/i;

export function kindOf(page: Pick<FzPage, "title" | "section" | "categories">): string | null {
  const forKids = FOR_KIDS.test(page.title);
  if (!forKids && (GROWN_UP_TITLE.test(page.title) || page.categories.some((c) => GROWN_UP.test(c)))) return null;
  const event = page.section === "Agenda";
  for (const [re, kind] of event ? [...EVENT_KINDS, ...PLACE_KINDS] : [...PLACE_KINDS, ...EVENT_KINDS]) {
    if (page.categories.some((c) => re.test(c))) return kind;
  }
  if (!forKids) return null;
  return event ? "Event" : "Outing";
}

/** Activity for a page, or null when it is not for families, too far, or over. */
export function toActivity(url: string, page: FzPage, today: string): Activity | null {
  if (page.lat === undefined || page.lng === undefined) return null;
  if (distanceKm({ lat: page.lat, lng: page.lng }, ZURICH_HB) > MAX_KM) return null;
  const kind = kindOf(page);
  if (!kind || !page.title) return null;
  let dates: ActivityDate[] | undefined;
  let months: number[] | undefined;
  if (page.section === "Agenda") {
    dates = parseSchedule(page.schedule);
    if (!dates.length && page.eventStart) dates = [page.eventEnd && page.eventEnd > page.eventStart ? { start: page.eventStart, end: page.eventEnd } : { start: page.eventStart }];
    dates = dates.filter((d) => (d.end ?? d.start) >= today);
    if (!dates.length) return null;
  } else {
    const seasonal = SEASONS.filter(([re]) => page.categories.some((c) => re.test(c))).flatMap(([, m]) => m);
    if (seasonal.length && seasonal.length < 12) months = seasonal;
  }
  const activity: Activity = {
    id: `freizeit:${slugOf(url)}`,
    source: "freizeit",
    title: page.title,
    url,
    kind,
    lat: page.lat,
    lng: page.lng,
    place: page.city,
    months,
    costChf: childPrice(page),
    dates,
    tags: page.categories.filter((c) => !NOISE.test(c) && !SEASONS.some(([re]) => re.test(c))).slice(0, 6),
  };
  for (const k of Object.keys(activity) as (keyof Activity)[]) if (activity[k] === undefined) delete activity[k];
  if (!activity.tags?.length) delete activity.tags;
  return activity;
}

export const freizeit: Source = {
  id: "freizeit",
  name: "freizeit.ch",
  url: BASE,
  async run(ctx: Context) {
    const lastmods = new Map<string, string | undefined>();
    for (const sm of parseSitemap(await ctx.http.text(`${BASE}/wp-sitemap.xml`))) {
      const type = /wp-sitemap-posts-([a-z_]+)-\d+\.xml$/.exec(sm.loc)?.[1];
      if (!type || !TYPES.has(type)) continue;
      for (const { loc, lastmod } of parseSitemap(await ctx.http.text(sm.loc))) lastmods.set(loc, lastmod);
    }
    const urls = new Set<string>();
    for (const region of REGIONS) {
      const listing = `${BASE}/category/region/${region}/`;
      const first = parseListing(await ctx.http.text(listing));
      const cards = [...first.cards];
      for (let p = 2; p <= first.lastPage; p++) cards.push(...parseListing(await ctx.http.text(`${listing}?page=${p}`)).cards);
      for (const card of cards) if (TYPES.has(card.type)) urls.add(card.url);
      ctx.log(`freizeit: ${region}: ${first.lastPage} listing pages, ${urls.size} pages so far`);
    }
    const today = ctx.now.toISOString().slice(0, 10);
    const out: Activity[] = [];
    let fetched = 0;
    for (const url of urls) {
      const lastmod = lastmods.get(url);
      const state = ctx.state.pages[url];
      if (isFresh(state, lastmod, ctx.now, MAX_AGE_DAYS, VERSION)) {
        const kept = reuse(ctx, state!);
        if (kept) {
          out.push(...kept.filter((a) => !a.dates || a.dates.some((d) => (d.end ?? d.start) >= today)));
          continue;
        }
      }
      if (fetched >= ctx.maxPages) continue;
      fetched += 1;
      let html: string;
      try {
        html = await ctx.http.text(url);
      } catch (e) {
        ctx.log(`freizeit: ${(e as Error).message}`);
        const kept = state ? reuse(ctx, state) : null;
        if (kept) out.push(...kept);
        continue;
      }
      const activity = toActivity(url, parsePage(html), today);
      remember(ctx, url, lastmod, activity ? [activity] : [], VERSION);
      if (activity) out.push(activity);
      if (fetched % 100 === 0) ctx.log(`freizeit: fetched ${fetched} of ${urls.size} pages`);
    }
    ctx.log(`freizeit: fetched ${fetched}, ${out.length} activities`);
    return out;
  },
};
