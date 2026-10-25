/**
 * Activity index: outings and kids' offers around Zürich, built by
 * scripts/activities and served as a static activities.json.
 *
 * The index holds facts and a link back to the source page only. Descriptions
 * and images stay on the source sites.
 */
import { addDays, weekday } from "./dates";
import { categorize, type ActivityCategory } from "./categories";
import type { CellClimate } from "./climate";
import { SOURCE_RANK } from "./duplicates";
export { distanceKm, ZURICH_HB } from "./geo";
export { CATEGORIES, categorize, settingFromText, type ActivityCategory } from "./categories";
import type { ISODate } from "./types";

export type ActivitySourceId = "swissfamilyfun" | "familienausflug" | "osm" | "gz" | "sportamt" | "ferienplausch" | "kikuka" | "zuerich" | "freizeit" | "zuerioberland" | "myswitzerland";

export type Setting = "indoor" | "outdoor" | "mixed";

/** One scheduled occurrence. `end` is inclusive and omitted for single days. */
export interface ActivityDate {
  start: ISODate;
  end?: ISODate;
  /** "10:00–16:00". */
  time?: string;
}

export interface Hike {
  km?: number;
  hours?: number;
  loop?: boolean;
  upM?: number;
  downM?: number;
  /** "easy", "moderate", "T3" … as the source wrote it. */
  skill?: string;
}

/** Another source's listing of the same place or event. */
export interface ActivityListing {
  id: string;
  source: ActivitySourceId;
  feed?: string;
  title: string;
  url: string;
}

export interface Activity {
  /** `${source}:${slug}`, stable across rebuilds. */
  id: string;
  source: ActivitySourceId;
  /** Part of a source that can be switched off on its own: the GZ centre ("gz-witikon"). */
  feed?: string;
  title: string;
  url: string;
  /** Short label: "Hike", "Museum", "Indoor play", "Holiday course" … */
  kind: string;
  /** What it is about, for the category filter. Set by the indexer (see categorize). */
  category?: ActivityCategory;
  setting?: Setting;
  lat?: number;
  lng?: number;
  place?: string;
  /** Straight line from Zürich HB. */
  distanceKm?: number;
  carMin?: number;
  transitMin?: number;
  /** Highest point for hikes, site elevation otherwise. */
  altitudeM?: number;
  hike?: Hike;
  stroller?: boolean;
  /** Months it is worth going, 1–12. Missing means year-round or unknown. */
  months?: number[];
  ageMin?: number;
  ageMax?: number;
  /** Inclusive birth-year range when the source states one (Sportamt). */
  birthYears?: [number, number];
  /** Lowest price per child in CHF; 0 is free. */
  costChf?: number;
  /** Scheduled offers only. Missing means go any time (in season). */
  dates?: ActivityDate[];
  /**
   * For weekly courses: the date ranges above only count on these weekdays
   * (0 = Sunday … 6 = Saturday).
   */
  weekdays?: number[];
  booking?: "required" | "drop-in" | "closed";
  tags?: string[];
  /**
   * Set by the indexer when another source lists the same thing: the id of
   * the listing shown for both (see findDuplicates). mergeDuplicates folds
   * this one into it.
   */
  duplicateOf?: string;
  /** Other sources listing it, set by mergeDuplicates. */
  also?: ActivityListing[];
}

export interface ActivitySourceInfo {
  id: ActivitySourceId;
  name: string;
  url: string;
  count: number;
  /** ISO timestamp of the last successful fetch. */
  fetchedAt?: string;
  /** Set when the last run failed and older entries were kept. */
  error?: string;
  /** Parts of the source with their own on/off switch (GZ centres). */
  feeds?: { id: string; name: string; count: number }[];
}

export interface ActivityIndex {
  v: 1;
  generatedAt: string;
  sources: ActivitySourceInfo[];
  /** Typical weather per region for outdoor places (see climateCell). */
  climate?: Record<string, CellClimate>;
  activities: Activity[];
}

export function activityCategory(a: Activity): ActivityCategory {
  return a.category ?? categorize(a);
}

/** Chip labels on the Ideas page. */
export const SOURCE_SHORT_NAMES: Record<ActivitySourceId, string> = {
  swissfamilyfun: "Swiss Family Fun",
  familienausflug: "familienausflug",
  osm: "OpenStreetMap",
  gz: "GZ",
  sportamt: "Sportamt",
  ferienplausch: "Ferienplausch",
  kikuka: "KiKuKa",
  zuerich: "Zürich Tourism",
  freizeit: "freizeit.ch",
  zuerioberland: "Zürioberland",
  myswitzerland: "MySwitzerland",
};

export const SOURCE_NAMES: Record<ActivitySourceId, string> = {
  swissfamilyfun: "Swiss Family Fun",
  familienausflug: "familienausflug.info",
  osm: "OpenStreetMap",
  gz: "Zürcher Gemeinschaftszentren",
  sportamt: "Sportamt Stadt Zürich",
  ferienplausch: "Pro Juventute Ferienplausch",
  kikuka: "KiKuKa Kinder Kultur Kalender",
  zuerich: "Zürich Tourismus",
  freizeit: "freizeit.ch",
  zuerioberland: "Zürioberland Tourismus",
  myswitzerland: "MySwitzerland (Schweiz Tourismus)",
};

/**
 * Driving minutes from Zürich: the source's own car time, else an estimate
 * from the straight-line distance (roads run about a third longer, at roughly
 * 60 km/h overall, plus parking).
 */
export function travelMinutes(a: Activity): { minutes: number; estimated: boolean } | null {
  if (a.carMin !== undefined) return { minutes: a.carMin, estimated: false };
  if (a.distanceKm !== undefined) return { minutes: Math.round(5 + a.distanceKm * 1.3), estimated: true };
  return null;
}

/** Months (1–12) touched by an inclusive date range. */
export function monthsInRange(start: ISODate, end: ISODate): number[] {
  const out = new Set<number>();
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.add(m);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.size === 12) break;
  }
  return [...out];
}

export function inSeason(a: Activity, start: ISODate, end: ISODate): boolean {
  if (!a.months?.length) return true;
  return monthsInRange(start, end).some((m) => a.months!.includes(m));
}

/** Dates of `a` that overlap the inclusive range (on one of its weekdays, if set), in order. */
export function datesInRange(a: Activity, start: ISODate, end: ISODate): ActivityDate[] {
  return (a.dates ?? []).filter((d) => {
    const from = d.start > start ? d.start : start;
    const to = (d.end ?? d.start) < end ? (d.end ?? d.start) : end;
    if (from > to) return false;
    if (!a.weekdays?.length) return true;
    for (let day = from, i = 0; day <= to && i < 7; day = addDays(day, 1), i++) {
      if (a.weekdays.includes(weekday(day))) return true;
    }
    return false;
  });
}

/** Age a kid born in `birthYear` reaches during `year`. */
export function ageInYear(birthYear: number, year: number): number {
  return year - birthYear;
}

/**
 * Whether an activity suits a kid born in `birthYear`, in the year the range
 * starts. Birth-year ranges are exact; age ranges allow one year either side
 * because a birthday may fall either way of the activity date.
 */
export function fitsBirthYear(a: Activity, birthYear: number, year: number): boolean {
  if (a.birthYears) return birthYear >= a.birthYears[0] && birthYear <= a.birthYears[1];
  const age = ageInYear(birthYear, year);
  if (a.ageMin !== undefined && age < a.ageMin) return false;
  if (a.ageMax !== undefined && age - 1 > a.ageMax) return false;
  return true;
}

export type SettingFilter = "any" | "outdoor" | "indoor";

export function matchesSetting(a: Activity, filter: SettingFilter): boolean {
  if (filter === "any" || !a.setting || a.setting === "mixed") return true;
  return a.setting === filter;
}


/** Fields a merged entry takes from another listing when its own listing lacks them. */
const FILLED = ["place", "setting", "carMin", "transitMin", "altitudeM", "hike", "stroller", "months", "costChf", "booking"] as const;

function rank(source: string): number {
  const i = SOURCE_RANK.indexOf(source);
  return i === -1 ? SOURCE_RANK.length : i;
}

function merge(head: Activity, others: Activity[]): Activity {
  const out: Activity = { ...head };
  const sorted = [...others].sort((x, y) => rank(x.source) - rank(y.source));
  for (const o of sorted) {
    for (const k of FILLED) if (out[k] === undefined && o[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = o[k];
    // Ages go together: one source's minimum with another's maximum would be a range neither states.
    if (out.ageMin === undefined && out.ageMax === undefined && !out.birthYears && (o.ageMin !== undefined || o.ageMax !== undefined || o.birthYears)) {
      out.ageMin = o.ageMin;
      out.ageMax = o.ageMax;
      out.birthYears = o.birthYears;
    }
  }
  const tags = [...new Set([...(head.tags ?? []), ...sorted.flatMap((o) => o.tags ?? [])])];
  if (tags.length) out.tags = tags;
  if (head.dates) {
    const dates = new Map<string, ActivityDate>();
    for (const d of [head, ...sorted].flatMap((a) => a.dates ?? [])) dates.set(`${d.start}|${d.end ?? ""}|${d.time ?? ""}`, d);
    out.dates = [...dates.values()].sort((x, y) => x.start.localeCompare(y.start));
  }
  out.also = sorted.map((o) => ({ id: o.id, source: o.source, feed: o.feed, title: o.title, url: o.url }));
  for (const k of Object.keys(out) as (keyof Activity)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/**
 * One entry per place or event: listings the indexer marked as duplicates are
 * folded into the listing shown for them, which keeps its own title and link,
 * fills facts it lacks from the others (best-ranked source first) and lists
 * them in `also`.
 */
export function mergeDuplicates(activities: readonly Activity[]): Activity[] {
  const ids = new Set(activities.map((a) => a.id));
  const extra = new Map<string, Activity[]>();
  for (const a of activities) {
    if (a.duplicateOf && ids.has(a.duplicateOf)) extra.set(a.duplicateOf, [...(extra.get(a.duplicateOf) ?? []), a]);
  }
  const out: Activity[] = [];
  for (const a of activities) {
    if (a.duplicateOf && ids.has(a.duplicateOf)) continue;
    const others = extra.get(a.id);
    out.push(others ? merge(a, others) : a);
  }
  return out;
}

/** The activity's own listing and the other sources' ones. */
export function listings(a: Activity): { id: string; source: ActivitySourceId; feed?: string }[] {
  return [a, ...(a.also ?? [])];
}

/** Settings key that switches off one feed of a source: "gz/gz-witikon". */
export function feedKey(source: ActivitySourceId, feed: string): string {
  return `${source}/${feed}`;
}

/** Whether one of the sources listing it is on in Settings, with its feed. */
export function sourceShown(a: Activity, hidden: ReadonlySet<string>): boolean {
  return listings(a).some((l) => !hidden.has(l.source) && (!l.feed || !hidden.has(feedKey(l.source, l.feed))));
}

/** Whether a mark set on any of its listings applies. */
export function hasId(a: Activity, ids: ReadonlySet<string> | undefined): boolean {
  return !!ids && listings(a).some((l) => ids.has(l.id));
}

export interface IdeaQuery {
  start: ISODate;
  end: ISODate;
  setting: SettingFilter;
  /** Upper bound on travelMinutes; null = any distance. */
  maxMinutes: number | null;
  /** Kids to fit; an activity matches if it suits at least one. Empty = no age filter. */
  birthYears: number[];
  text?: string;
  /** Sources and feeds switched off in Settings (see sourceShown). */
  hiddenSources?: readonly string[];
  /** Activity ids marked as favourites: listed first. */
  favorites?: ReadonlySet<string>;
  /** Activity ids marked as not relevant: left out. */
  hidden?: ReadonlySet<string>;
}

function matchesText(a: Activity, text: string | undefined): boolean {
  const q = text?.trim().toLowerCase();
  if (!q) return true;
  const hay = [a.title, a.kind, a.place, ...(a.tags ?? []), ...(a.also ?? []).map((l) => l.title)].join(" ").toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

function matchesCommon(a: Activity, q: IdeaQuery): boolean {
  if (!matchesSetting(a, q.setting)) return false;
  if (!matchesText(a, q.text)) return false;
  if (q.maxMinutes !== null) {
    const t = travelMinutes(a);
    if (t && t.minutes > q.maxMinutes) return false;
  }
  if (q.birthYears.length) {
    const year = Number(q.start.slice(0, 4));
    if (!q.birthYears.some((b) => fitsBirthYear(a, b, year))) return false;
  }
  return true;
}

export interface DatedIdea {
  activity: Activity;
  dates: ActivityDate[];
}

export interface Ideas {
  /** Camps, events and one-off courses with a date in the range: favourites first, then those within it, then soonest; full ones last. */
  dated: DatedIdea[];
  /** Courses that run weekly over months (semester courses), same order. */
  weekly: DatedIdea[];
  /** Places to go any time in season: favourites, then seasonal ones, then closest first. */
  places: Activity[];
}

export function findIdeas(activities: readonly Activity[], q: IdeaQuery): Ideas {
  const dated: DatedIdea[] = [];
  const weekly: DatedIdea[] = [];
  const places: Activity[] = [];
  const hidden = new Set(q.hiddenSources ?? []);
  for (const a of activities) {
    if (hasId(a, q.hidden) || !sourceShown(a, hidden) || !matchesCommon(a, q)) continue;
    if (a.dates) {
      const dates = datesInRange(a, q.start, q.end);
      if (dates.length) (a.weekdays?.length ? weekly : dated).push({ activity: a, dates });
    } else if (inSeason(a, q.start, q.end)) {
      places.push(a);
    }
  }
  // Offers that happen within the dates (a Saturday event, a camp week) rank
  // above long runs that merely overlap them.
  const within = (d: DatedIdea) => Number(d.dates.some((x) => x.start >= q.start && (x.end ?? x.start) <= q.end));
  const favorite = (a: Activity) => Number(hasId(a, q.favorites));
  const byDate = (x: DatedIdea, y: DatedIdea) =>
    favorite(y.activity) - favorite(x.activity) ||
    Number(x.activity.booking === "closed") - Number(y.activity.booking === "closed") ||
    within(y) - within(x) ||
    x.dates[0].start.localeCompare(y.dates[0].start) ||
    x.activity.title.localeCompare(y.activity.title);
  dated.sort(byDate);
  weekly.sort(byDate);
  const minutes = (a: Activity) => travelMinutes(a)?.minutes ?? Number.POSITIVE_INFINITY;
  // Places with a season that includes the dates (sledding in winter, a pool
  // in summer) suit those dates better than places that are always open.
  const seasonal = (a: Activity) => Number(!!a.months?.length && a.months.length < 12);
  places.sort((x, y) => favorite(y) - favorite(x) || seasonal(y) - seasonal(x) || minutes(x) - minutes(y) || x.title.localeCompare(y.title));
  return { dated, weekly, places };
}

/** Saturday–Sunday of the weekend on or after `today` (today itself if it is Sunday). */
export function weekendFrom(today: ISODate, weeksAhead = 0): { start: ISODate; end: ISODate } {
  const wd = weekday(today);
  const saturday = wd === 0 ? addDays(today, -1) : addDays(today, (6 - wd + 7) % 7);
  const start = addDays(saturday, weeksAhead * 7);
  return { start, end: addDays(start, 1) };
}

/** "5 km loop · 2 h · ↑250 m · max 1115 m". */
export function hikeLine(a: Activity): string {
  const parts: string[] = [];
  const h = a.hike;
  if (h?.km !== undefined) parts.push(`${h.km} km${h.loop ? " loop" : ""}`);
  if (h?.hours !== undefined) parts.push(`${h.hours} h`);
  if (h?.upM !== undefined) parts.push(`↑${h.upM} m`);
  if (h?.downM !== undefined && h.downM !== h.upM) parts.push(`↓${h.downM} m`);
  if (a.altitudeM !== undefined && (h || a.altitudeM >= 800)) parts.push(`${h ? "max " : ""}${a.altitudeM} m`);
  if (h?.skill) parts.push(h.skill);
  return parts.join(" · ");
}

export function ageLabel(a: Activity): string {
  if (a.birthYears) return `born ${a.birthYears[0]}–${a.birthYears[1]}`;
  if (a.ageMin !== undefined && a.ageMax !== undefined) return `${a.ageMin}–${a.ageMax} y`;
  if (a.ageMin !== undefined) return `${a.ageMin}+ y`;
  if (a.ageMax !== undefined) return `up to ${a.ageMax} y`;
  return "";
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "May–Oct", or "" when year-round. Runs wrap over the new year ("Dec–Mar"). */
export function seasonLabel(months: readonly number[] | undefined): string {
  const set = new Set(months ?? []);
  if (set.size === 0 || set.size >= 12) return "";
  const prev = (m: number) => (m === 1 ? 12 : m - 1);
  // Start where a run begins so a run over the new year stays whole.
  const first = [...set].find((m) => !set.has(prev(m)))!;
  const runs: string[] = [];
  let from: number | null = null;
  for (let i = 0; i <= 12; i++) {
    const m = ((first - 1 + i) % 12) + 1;
    const present = i < 12 && set.has(m);
    if (present && from === null) from = m;
    if (!present && from !== null) {
      const to = prev(m);
      runs.push(from === to ? MONTH_ABBR[from - 1] : `${MONTH_ABBR[from - 1]}–${MONTH_ABBR[to - 1]}`);
      from = null;
    }
  }
  return runs.join(", ");
}
