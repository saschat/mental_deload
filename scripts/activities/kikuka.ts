// KiKuKa (kikuka.ch), the Kinder Kultur Kalender of the City and Canton of
// Zürich: theatre, music, film, workshops and museum offers for kids up to 12.
// There is no API. The calendar loads three days at a time as JSON-wrapped
// HTML (the page's own infinite scroll), filtered by Sparte, which gives the
// category. Each event's modal adds the address and price.

import type { Activity, ActivityDate } from "../../src/core/activities.ts";
import { distanceKm, ZURICH_HB } from "../../src/core/geo.ts";
import { isFresh, type Context, type Source } from "./context.ts";
import { compactDates, decodeEntities, htmlToText, inlineText, iso, parseChf } from "./text.ts";

const BASE = "https://kikuka.ch";
/** Days of calendar to read ahead; few events are listed further out. */
const HORIZON_DAYS = 180;
const DAYS_PER_PAGE = 3;
/** Event pages (address, price) are re-read after this long. */
const MAX_AGE_DAYS = 45;
/** 4: town added to bare street addresses, matches checked against distance. */
const VERSION = 4;
/** A run longer than this is opening hours or a semester course rather than a programme. */
const LONG_RUN_DAYS = 42;
const AJAX = { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" };

/** Sparten in the order that names an event listed under several. */
export const SPARTEN: { id: number; name: string; kind: string }[] = [
  { id: 1, name: "Theater", kind: "Theatre" },
  { id: 7, name: "Zirkus", kind: "Circus" },
  { id: 3, name: "Film", kind: "Film" },
  { id: 2, name: "Musik", kind: "Music" },
  { id: 4, name: "Tanz", kind: "Dance" },
  { id: 5, name: "Literatur", kind: "Stories" },
  { id: 8, name: "Workshops", kind: "Workshop" },
  { id: 18, name: "Ausstellungen", kind: "Exhibition" },
  { id: 6, name: "Museum", kind: "Museum" },
];

const MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  märz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
};
const WEEKDAYS: Record<string, number> = { so: 0, mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6 };

/** One event card under one day of the calendar. */
export interface KikukaCard {
  id: string;
  /** Path of the event page, "/event/Landesmuseum%20Z%C3%BCrich/26969". */
  path: string;
  day: string;
  title: string;
  venue: string;
  ages?: [number, number];
  /** Set for runs ("17. August 2026 – 28. November 2026"); single dates have none. */
  run?: { start: string; end: string; weekdays: number[] };
  /** "14:00–15:45", several joined with ", ". */
  time?: string;
}

function germanDate(day: string, month: string, year: string): string | undefined {
  const m = MONTHS[month.toLowerCase()];
  return m ? iso(Number(year), m, Number(day)) : undefined;
}

function times(html: string): string | undefined {
  const slots = [...html.matchAll(/(\d{1,2})\.(\d{2})\s*Uhr\s*–\s*(\d{1,2})\.(\d{2})\s*Uhr/g)].map((m) => {
    const from = `${m[1].padStart(2, "0")}:${m[2]}`;
    const to = `${m[3].padStart(2, "0")}:${m[4]}`;
    return from === to ? from : `${from}–${to}`;
  });
  return [...new Set(slots)].join(", ") || undefined;
}

/** Cards from one calendar response, each with the day it is listed under. */
export function parseCalendar(html: string): KikukaCard[] {
  const out: KikukaCard[] = [];
  const days = [...html.matchAll(/data-calendar-date="(\d{4}-\d{2}-\d{2})"/g)];
  days.forEach((d, i) => {
    const section = html.slice(d.index, days[i + 1]?.index ?? html.length);
    for (const m of section.matchAll(/<a href="(\/event\/[^"]*\/(\d+))" class="js-event-link[\s\S]*?<\/a>/g)) {
      const card = m[0];
      const title = inlineText(/<div class="list-title">\s*<h2>([\s\S]*?)<\/h2>/.exec(card)?.[1] ?? "");
      if (!title) continue;
      const schedule = /<span class="d-block time">([\s\S]*?)<span class="list-view-age/.exec(card)?.[1] ?? card;
      const age = /list-view-age[^>]*>\s*(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s*Jahre/.exec(card);
      const run = /(\d{1,2})\.\s*(\p{L}+)\s*(\d{4})<\/span>\s*–\s*<span class="nowrap">(\d{1,2})\.\s*(\p{L}+)\s*(\d{4})/u.exec(schedule);
      const start = run && germanDate(run[1], run[2], run[3]);
      const end = run && germanDate(run[4], run[5], run[6]);
      const dayNames = /<span class="schedule-day">([^<]*)<\/span>/.exec(schedule)?.[1] ?? "";
      const weekdays = [...new Set([...dayNames.matchAll(/\b(Mo|Di|Mi|Do|Fr|Sa|So)/g)].map((w) => WEEKDAYS[w[1].toLowerCase()]))].sort();
      out.push({
        id: m[2],
        path: m[1],
        day: d[1],
        title,
        venue: inlineText(/<span class="d-block venue">([\s\S]*?)<\/span>/.exec(card)?.[1] ?? ""),
        ages: age ? [Number(age[1]), Number(age[2] ?? age[1])] : undefined,
        run: start && end ? { start, end, weekdays } : undefined,
        time: times(schedule),
      });
    }
  });
  return out;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * What an event is from its cards: a programme on the listed days, a place to
 * visit during opening hours (a long run on five or more days a week), or a
 * weekly course (a long run on a few weekdays only), which is left out like
 * the Sportamt's semester courses. Long runs that include a weekend day
 * (Sunday tours) count as a programme on those days.
 */
export function eventShape(cards: KikukaCard[]): "dated" | "place" | "course" {
  const run = cards.find((c) => c.run)?.run;
  if (!run || daysBetween(run.start, run.end) <= LONG_RUN_DAYS) return "dated";
  if (run.weekdays.length >= 5) return "place";
  return run.weekdays.some((d) => d === 0 || d === 6) ? "dated" : "course";
}

/** Facts from an event's modal. */
export interface KikukaDetail {
  address?: string;
  costChf?: number;
  booking?: "required" | "drop-in";
}

export function parseDetail(html: string): KikukaDetail {
  const sub = /<div class="sub-info">([\s\S]*?)<div class="(?:end-links|map)/.exec(html)?.[1] ?? "";
  const cost = /<strong>Kosten<\/strong>([\s\S]*?)(?=<strong>|$)/.exec(sub)?.[1];
  const place = /<strong>Veranstaltungsort\(e\)<\/strong>[\s\S]*?<a [^>]*>([^<]+)<\/a>/.exec(sub)?.[1];
  const text = htmlToText(/<span class="description">([\s\S]*?)<\/span>/.exec(html)?.[1] ?? "").toLowerCase();
  const booking = /ohne anmeldung|keine anmeldung|einfach vorbei/.test(text)
    ? "drop-in"
    : /anmeldung (?:ist )?(?:erforderlich|obligatorisch|notwendig|nötig)|mit anmeldung|anmeldung unter|anmeldung bis|platzzahl beschränkt|tickets? (?:reservier|vorverkauf)/.test(text)
      ? "required"
      : undefined;
  return {
    address: place ? decodeEntities(place).replace(/\s+/g, " ").trim() : undefined,
    costChf: parseChf(cost ? inlineText(cost).replace(/preiskategorie:\s*/i, "") : undefined),
    booking,
  };
}

/** The index entry for one event, from its cards (any Sparte), Sparten and modal. */
export function toActivity(cards: KikukaCard[], sparten: number[], detail: KikukaDetail): Activity | null {
  const first = cards[0];
  const shape = eventShape(cards);
  if (!first || shape === "course") return null;
  const names = SPARTEN.filter((s) => sparten.includes(s.id));
  const dates: ActivityDate[] | undefined =
    shape === "place" ? undefined : compactDates(cards.map((c) => ({ start: c.day, time: c.time })));
  const activity: Activity = {
    id: `kikuka:${first.id}`,
    source: "kikuka",
    title: first.title,
    url: `${BASE}${first.path}`,
    kind: names[0]?.kind ?? "Event",
    place: first.venue || undefined,
    ageMin: first.ages?.[0],
    ageMax: first.ages?.[1],
    costChf: detail.costChf,
    dates,
    booking: detail.booking,
    tags: [...names.map((s) => s.name.toLowerCase()), first.venue].filter(Boolean),
  };
  for (const k of Object.keys(activity) as (keyof Activity)[]) if (activity[k] === undefined) delete activity[k];
  return activity;
}

/** The calendar covers the canton; a match further away is a different street of the same name. */
const MAX_KM = 80;
/** For addresses read as being in the city (no town given), as "GZ Affoltern" also names a village in Bern. */
const CITY_KM = 25;
const TOWN = /\b\d{4}\s+\p{L}/u;

/**
 * Geocoder queries for an event, best first, each with how far from Zürich a
 * match may be. Some events give only a street ("Bergstrasse 111") with the
 * town in the venue ("8707 Uetikon am See"), only a name ("Kloster
 * Einsiedeln", "GZ Affoltern"), or lead with names the geocoder does not know
 * ("Kindertreff Viadukt, Josefwiese, Bogen 16, 8005 Zürich").
 */
export function geocodeQueries(address: string | undefined, venue: string): { q: string; km: number }[] {
  const town = TOWN.test(venue) ? venue : undefined;
  const out: { q: string; km: number }[] = [];
  const add = (q: string, km: number) => {
    if (!out.some((o) => o.q === q)) out.push({ q, km });
  };
  if (address) {
    const given = TOWN.test(address);
    const full = given ? address : `${address}, ${town ?? "Zürich"}`;
    add(full, given || town ? MAX_KM : CITY_KM);
    // A Gemeinschaftszentrum is named after its Quartier of the city.
    const gz = /^GZ\s+([^,]+)/.exec(address);
    if (gz) add(`${gz[1]} Zürich`, CITY_KM);
    // A name without a street number: the geocoder may know the place itself.
    if (!given && !/\d/.test(address)) add(address, MAX_KM);
    const parts = full.split(/,\s*/);
    for (let i = 1; i < parts.length; i += 1) {
      const q = parts.slice(i).join(", ");
      add(q, TOWN.test(q) || q === town ? MAX_KM : CITY_KM);
    }
  }
  if (town) add(town, MAX_KM);
  return out;
}

async function locate(ctx: Context, address: string | undefined, venue: string): Promise<[number, number] | null> {
  for (const { q, km } of geocodeQueries(address, venue)) {
    const at = await ctx.geocode(q);
    if (at && distanceKm(ZURICH_HB, { lat: at[0], lng: at[1] }) <= km) return at;
  }
  return null;
}

function addDaysIso(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export const kikuka: Source = {
  id: "kikuka",
  name: "KiKuKa Kinder Kultur Kalender",
  url: BASE,
  async run(ctx: Context) {
    const today = ctx.now.toISOString().slice(0, 10);
    const cards = new Map<string, KikukaCard[]>();
    const sparten = new Map<string, number[]>();
    for (const sparte of SPARTEN) {
      for (let offset = 0; offset < HORIZON_DAYS; offset += DAYS_PER_PAGE) {
        const start = addDaysIso(today, offset);
        const body = await ctx.http.json<{ response?: string }>(`${BASE}/kalender?start_date=${start}&category=${sparte.id}`, {
          headers: AJAX,
        });
        for (const card of parseCalendar(body.response ?? "")) {
          const list = cards.get(card.id) ?? [];
          if (!list.some((c) => c.day === card.day)) list.push(card);
          cards.set(card.id, list);
          const s = sparten.get(card.id) ?? [];
          if (!s.includes(sparte.id)) sparten.set(card.id, [...s, sparte.id]);
        }
      }
      ctx.log(`kikuka: ${sparte.name} done, ${cards.size} events so far`);
    }

    const out: Activity[] = [];
    let fetched = 0;
    let courses = 0;
    for (const [id, list] of cards) {
      list.sort((a, b) => a.day.localeCompare(b.day));
      if (eventShape(list) === "course") {
        courses += 1;
        continue;
      }
      const url = `${BASE}${list[0].path}`;
      const page = ctx.state.pages[url];
      const before = ctx.previous.get(`kikuka:${id}`);
      let detail: KikukaDetail = { costChf: before?.costChf, booking: before?.booking === "closed" ? undefined : before?.booking };
      let at: [number, number] | null = before?.lat !== undefined && before.lng !== undefined ? [before.lat, before.lng] : null;
      if (!(before && isFresh(page, undefined, ctx.now, MAX_AGE_DAYS, VERSION)) && fetched < ctx.maxPages) {
        fetched += 1;
        try {
          const body = await ctx.http.json<{ content?: string }>(url, { headers: AJAX });
          detail = parseDetail(body.content ?? "");
          at = await locate(ctx, detail.address, list[0].venue);
          ctx.state.pages[url] = { fetchedAt: ctx.now.toISOString(), ids: [`kikuka:${id}`], v: VERSION };
        } catch (e) {
          ctx.log(`kikuka: ${(e as Error).message}`);
        }
      }
      const activity = toActivity(list, sparten.get(id) ?? [], detail);
      if (!activity) continue;
      if (at) Object.assign(activity, { lat: at[0], lng: at[1] });
      out.push(activity);
    }
    ctx.log(`kikuka: ${out.length} events (${courses} weekly courses left out), fetched ${fetched} event pages`);
    return out;
  },
};
