// HTML-to-text and the free-text parsers shared by the sources. Source pages
// write facts as prose ("1hr10 from Zurich", "mid-June through October",
// "ab 6 Jahren"), so these turn the common phrasings into numbers and give up
// (undefined) on anything else rather than guess.

import type { ActivityDate, Hike } from "../../src/core/activities.ts";

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bull: "•",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED[code] ?? m;
  });
}

/** Inline text of an HTML fragment on one line. */
export function inlineText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " / ").replace(/<[^>]+>/g, " "))
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s/]+|[\s/]+$/g, "");
}

/** Readable text with one line per block element. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|svg|noscript)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|h[1-6]|div|tr|td|dt|dd|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n[\s]*/g, "\n")
    .trim();
}

export function between(html: string, start: RegExp, end: RegExp): string | null {
  const s = start.exec(html);
  if (!s) return null;
  const rest = html.slice(s.index + s[0].length);
  const e = end.exec(rest);
  return e ? rest.slice(0, e.index) : rest;
}

const ZURICH = /z[uü]e?rich/i;
const OTHER_CITY = /\b(from|ab|von)\s+(basel|bern|lucerne|luzern|geneva|genf|lausanne|lugano|st\.? ?gallen|chur|zug|winterthur|interlaken)/i;

function durationIn(text: string): number | undefined {
  const t = text.toLowerCase();
  // "1hr10", "1 hr 30", "1h05", "2 hours", "1.5 hrs"
  let m = /(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|h|std\.?|stunden?)\b\s*(?:(\d{1,2})\s*(?:min(?:ute)?s?|m)?\b)?/.exec(t);
  const mins = /(\d+)\s*(?:min(?:ute)?s?|')/.exec(t);
  if (m && (!mins || m.index <= mins.index)) {
    const h = Number(m[1].replace(",", "."));
    const extra = m[2] ? Number(m[2]) : 0;
    return Math.round(h * 60 + extra);
  }
  // "1hr10" without a space is caught above; plain minutes otherwise.
  if (mins) return Number(mins[1]);
  m = /(\d+)hr(\d+)/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

/**
 * Travel minutes from Zürich in a fact line such as
 * "Metered parking / From Lucerne 5 mins, Zürich 45 mins" or "1hr10 from Zurich".
 * A line that only gives times from other cities yields undefined.
 */
export function parseTravelMinutes(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const parts = text.split(/[,/;•\n]| or /);
  const zurich = parts.find((p) => ZURICH.test(p) && durationIn(p) !== undefined);
  if (zurich) return durationIn(zurich);
  if (OTHER_CITY.test(text)) return undefined;
  for (const p of parts) {
    if (/parking|gps|°|\d{4}\s+[a-zäöü]/i.test(p) && !/\b(min|hr|hour|h)\b/i.test(p)) continue;
    const d = durationIn(p);
    if (d !== undefined && d > 0 && d < 8 * 60) return d;
  }
  return undefined;
}

/** "10 km one way, about 4.5 hours" · "3 km loop" · "500m to hut" · "3km round trip". */
export function parseTrail(text: string | undefined): Hike {
  const hike: Hike = {};
  if (!text) return hike;
  const t = text.toLowerCase().replace(/,(\d)/g, ".$1");
  const km = /(\d+(?:\.\d+)?)\s*km\b/.exec(t);
  const metres = /(\d{2,4})\s*m\b(?!in)/.exec(t);
  if (km) hike.km = Number(km[1]);
  else if (metres && Number(metres[1]) < 5000) hike.km = Number(metres[1]) / 1000;
  if (/\bloop\b|round[- ]trip|rundweg|rundwanderung/.test(t)) hike.loop = true;
  const hours = /(?:about|ca\.?|~)?\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:hours?|hrs?|h|std)\b/.exec(t);
  const mins = /(\d+)\s*min/.exec(t);
  if (hours) hike.hours = Number(hours[1]);
  else if (mins) hike.hours = Math.round((Number(mins[1]) / 60) * 10) / 10;
  return hike;
}

/**
 * "highest point 2125m, 340m up, 1010m down" · "2200m, 100m up/down" ·
 * "highest point 1115, 250m climb, 250m descent".
 */
export function parseElevation(text: string | undefined): { maxM?: number; upM?: number; downM?: number } {
  const out: { maxM?: number; upM?: number; downM?: number } = {};
  if (!text) return out;
  const t = text.toLowerCase().replace(/(\d)['’](\d{3})/g, "$1$2");
  const highest = /(?:highest point|max(?:imum)?|top)\D{0,5}(\d{3,4})/.exec(t);
  if (highest) out.maxM = Number(highest[1]);
  const both = /(\d{2,4})\s*m?\s*(?:up\s*\/\s*down|up and down|auf\s*\/\s*ab)/.exec(t);
  if (both) {
    out.upM = Number(both[1]);
    out.downM = Number(both[1]);
  }
  const up = /(\d{2,4})\s*m?\s*(?:up|climb|ascent|uphill|aufstieg)\b(?!\s*\/)/.exec(t);
  const down = /(\d{2,4})\s*m?\s*(?:down|descent|downhill|abstieg)\b/.exec(t);
  if (up) out.upM = Number(up[1]);
  if (down && !both) out.downM = Number(down[1]);
  if (out.maxM === undefined) {
    // A leading altitude such as "2200m, 100m up/down".
    const lead = /^\s*(?:at\s+)?(\d{3,4})\s*m\b/.exec(t);
    if (lead && Number(lead[1]) >= 400) out.maxM = Number(lead[1]);
  }
  return out;
}

const MONTHS: [RegExp, number][] = [
  [/\bjan(uary|uar)?\b/, 1],
  [/\bfeb(ruary|ruar)?\b/, 2],
  [/\bm(ar(ch)?|ärz|aerz)\b/, 3],
  [/\bapr(il)?\b/, 4],
  [/\bma[iy]\b/, 5],
  [/\bjun[ei]?\b/, 6],
  [/\bjul[iy]?\b/, 7],
  [/\baug(ust)?\b/, 8],
  [/\bsep(t(ember)?)?\b/, 9],
  [/\bo[ck]t(ober)?\b/, 10],
  [/\bnov(ember)?\b/, 11],
  [/\bde[cz](ember)?\b/, 12],
];

export function monthRange(from: number, to: number): number[] {
  const out: number[] = [];
  for (let m = from; ; m = (m % 12) + 1) {
    out.push(m);
    if (m === to || out.length === 12) break;
  }
  return out;
}

/**
 * Season from "mid-June through October", "best May to October",
 * "Dezember bis März". Year-round wording and unparseable text give undefined.
 */
export function parseMonths(text: string | undefined): number[] | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  if (/year[- ]round|all year|ganzjährig|ganzjaehrig|daily\b|täglich/.test(t) && !/\b(only|nur)\b.*\b(summer|winter|sommer)\b/.test(t)) {
    return undefined;
  }
  const found: { index: number; month: number }[] = [];
  for (const [re, month] of MONTHS) {
    const g = new RegExp(re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(t))) found.push({ index: m.index, month });
  }
  found.sort((a, b) => a.index - b.index);
  if (found.length >= 2) return monthRange(found[0].month, found[1].month);
  if (found.length === 1) return [found[0].month];
  if (/\bsummer\b|\bsommer\b/.test(t)) return monthRange(6, 9);
  if (/\bwinter\b/.test(t)) return monthRange(12, 3);
  return undefined;
}

const GRADE_AGE = 6; // A child in 1st grade (1. Klasse) is about 6–7.

/**
 * Age range from German or English text: "ab 6 Jahren", "3-6 Jahre",
 * "für Kinder von 0-4 Jahren", "bis ca. 4 Jahre", "ab der 1. Klasse",
 * "4. bis 6. Klasse", "Mittelstufe", "ages 8-15".
 */
export function parseAges(text: string | undefined): { min?: number; max?: number } {
  if (!text) return {};
  const t = text.toLowerCase().replace(/–|—/g, "-");
  let m = /(\d{1,2})\s*(?:-|bis|to)\s*(\d{1,2})\s*(?:j\b|j\.|jahr|jähr|year|y\b|yrs)/.exec(t);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  m = /(?:age[sd]?|alter)\s*(\d{1,2})\s*(?:-|to|bis)\s*(\d{1,2})/.exec(t);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  m = /(\d)\.\s*(?:-|bis)\s*(\d)\.\s*klasse/.exec(t);
  if (m) return { min: Number(m[1]) + GRADE_AGE - 1, max: Number(m[2]) + GRADE_AGE };
  const out: { min?: number; max?: number } = {};
  m = /\bab\s*(?:ca\.\s*)?(\d{1,2})\s*(?:j\b|j\.|jahr)|\b(?:from|over|aged?)\s*(\d{1,2})\+?\s*(?:years?|y\b)?|\b(\d{1,2})\s*\+\s*(?:j|y)/.exec(t);
  if (m) out.min = Number(m[1] ?? m[2] ?? m[3]);
  m = /\bab\s*(?:der\s*)?(\d)\.\s*klasse/.exec(t);
  if (m && out.min === undefined) out.min = Number(m[1]) + GRADE_AGE - 1;
  m = /\b(?:bis|unter|up to|under)\s*(?:ca\.\s*)?(\d{1,2})\s*(?:j\b|j\.|jahr|years?|y\b)/.exec(t);
  if (m) out.max = Number(m[1]);
  if (out.min !== undefined || out.max !== undefined) return out;
  if (/kindergarten|\bkiga\b/.test(t)) return { min: 4, max: 6 };
  if (/unterstufe/.test(t)) return { min: 6, max: 9 };
  if (/mittelstufe/.test(t)) return { min: 9, max: 12 };
  if (/oberstufe|sekundar/.test(t)) return { min: 12, max: 16 };
  if (/\bbab(y|ys|ies)\b|säugling/.test(t)) return { min: 0, max: 2 };
  if (/kleinkind/.test(t)) return { min: 1, max: 4 };
  return {};
}

// Ages near prices are ticket bands ("CHF 10/child aged 8-15"), not advice.
const PRICE_CONTEXT = /chf|€|\bfree\b|ticket|price|cost|discount|fare|junior card|\bpay\b|admission|entrance|\bpass\b|rental|tariff/i;
const ADVICE = /\b(suit(?:ed|able)|recommend(?:ed)?|suggest(?:ed)?|best|ideal|perfect|great|good|designed|aimed|geared|intended|appropriate|meant|fine|okay|manageable|doable)\b/i;
const KIDS = /\bkids?\b|child|toddler|teen|famil|year[- ]olds?/i;
const NOT_AN_AGE = String.raw`(?!\s*(?:hours?|hrs?|h\b|km|m\b|min|minutes|%|met(?:er|re)s?|people|persons|times|days|chf|francs))`;

/**
 * Target age from a recommendation in prose: "only suggest this for older
 * children (over 12)", "great for kids aged 4 and up", "not recommended for
 * kids under 8". Ticket price bands and plain anecdotes are ignored.
 */
export function parseSuitableAge(text: string | undefined): { min?: number; max?: number } {
  if (!text) return {};
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (PRICE_CONTEXT.test(sentence) || !ADVICE.test(sentence) || !KIDS.test(sentence)) continue;
    const s = sentence.toLowerCase().replace(/\u2013/g, "-");
    const negative = /\bnot\b|n't|\bavoid\b|\btoo (?:hard|difficult|dangerous|steep|long)\b/.test(s);
    let m = new RegExp(String.raw`(?:under|younger than|below)\s*(?:age\s*)?(\d{1,2})` + NOT_AN_AGE).exec(s);
    if (m && negative) return { min: Number(m[1]) };
    if (negative) continue;
    m = new RegExp(String.raw`(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*(?:years?|yrs?|y\.?o\b)`).exec(s);
    if (m) return { min: Number(m[1]), max: Number(m[2]) };
    m = new RegExp(String.raw`(?:aged?|ages|over|older than|from|at least|above)\s*(?:age\s*)?(\d{1,2})` + NOT_AN_AGE).exec(s);
    if (m) {
      const n = Number(m[1]);
      // "over 12" and "older than 12" mean 13 and up only in strict reading; families read them as 12+.
      if (n >= 2 && n <= 16) return { min: n };
    }
    m = /(\d{1,2})\s*(?:\+|and (?:up|older|above))/.exec(s);
    if (m) return { min: Number(m[1]) };
  }
  return {};
}

/**
 * Lowest price per child in CHF. Prefers an amount next to "child"/"Kind";
 * "free", "kostenlos", "Kollekte" give 0.
 */
export function parseChf(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  const amounts = (s: string) =>
    [...s.matchAll(/(?:chf|fr\.|sfr\.?)\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*(?:chf|fr\.|franken)/g)].map((m) =>
      Number((m[1] ?? m[2]).replace(",", ".")),
    );
  const child = t.split(/[,;/\n]|(?<=\.)\s/).filter((p) => /child|kind|kids|junior/.test(p));
  const childAmounts = child.flatMap(amounts);
  if (childAmounts.length) return Math.min(...childAmounts);
  const all = amounts(t);
  if (all.length) return Math.min(...all);
  if (/\bfree\b|kostenlos|gratis|eintritt frei|freier eintritt|kollekte|keine kosten|^\s*keine\s*$/.test(t)) return 0;
  return undefined;
}

export function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Sort, dedupe and merge consecutive days with the same time into ranges. */
export function compactDates(dates: readonly ActivityDate[]): ActivityDate[] {
  const unique = new Map<string, ActivityDate>();
  for (const d of dates) unique.set(`${d.start}|${d.end ?? ""}|${d.time ?? ""}`, d);
  const sorted = [...unique.values()].sort((a, b) => a.start.localeCompare(b.start) || (a.time ?? "").localeCompare(b.time ?? ""));
  const out: ActivityDate[] = [];
  for (const d of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.time === d.time && nextDay(prev.end ?? prev.start) === d.start) {
      prev.end = d.end ?? d.start;
    } else {
      out.push({ ...d });
    }
  }
  return out;
}

export function slugOf(url: string): string {
  return new URL(url).pathname.replace(/^\/+|\/+$/g, "").split("/").pop() ?? url;
}

export function round(n: number, digits = 5): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
