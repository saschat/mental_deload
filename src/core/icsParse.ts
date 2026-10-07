import ICAL from "ical.js";
import { addDays, toISODate } from "./dates";
import type { Category, ISODate, SourceCategory, UpstreamSnapshot } from "./types";

export interface ParsedItem extends UpstreamSnapshot {
  /** UID, plus "::" + RECURRENCE-ID for occurrences of recurring events. */
  externalKey: string;
  category: Category;
}

export interface ParseOptions {
  /** Ignore events that ended before this date. */
  from: ISODate;
  /** Expand recurrences / include events up to this date. */
  until: ISODate;
  defaultCategory: SourceCategory;
  /** Safety cap on occurrences per recurring event. */
  maxOccurrences?: number;
}

export interface ParseResult {
  items: ParsedItem[];
  calendarName?: string;
  skipped: number;
}

const BIRTHDAY_RE = /\b(birthday|b-?day|geburtstag|anniversaire|cumplea[nñ]os)\b|geburtstag/i;
const VACATION_RE =
  /\b(holidays?|vacations?|break|half[- ]term|urlaub|vacances|bridge day|br[uü]ckentag)\b|ferien|feiertag/i;

/** Guess a category from the title; falls back to the source default. */
export function detectCategory(title: string, fallback: SourceCategory, icsCategories: string[] = []): Category {
  const hay = `${title} ${icsCategories.join(" ")}`;
  if (BIRTHDAY_RE.test(hay)) return "birthday";
  if (VACATION_RE.test(hay)) return "vacation";
  return fallback === "auto" ? "other" : fallback;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

interface LocalTime {
  date: ISODate;
  time?: string;
}

function toLocal(t: ICAL.Time): LocalTime {
  if (t.isDate) {
    return { date: `${t.year}-${pad(t.month)}-${pad(t.day)}` };
  }
  const js = t.toJSDate();
  return { date: toISODate(js), time: `${pad(js.getHours())}:${pad(js.getMinutes())}` };
}

function toRange(start: ICAL.Time, end: ICAL.Time | null): Pick<UpstreamSnapshot, "start" | "end" | "startTime" | "endTime"> {
  const s = toLocal(start);
  if (!end) return { start: s.date, end: s.date, startTime: s.time };
  const e = toLocal(end);
  if (start.isDate) {
    // All-day DTEND is exclusive.
    const last = addDays(e.date, -1);
    return { start: s.date, end: last < s.date ? s.date : last };
  }
  let endDate = e.date;
  // A timed event ending exactly at midnight ends on the previous day.
  if (e.time === "00:00" && endDate > s.date) endDate = addDays(endDate, -1);
  return { start: s.date, end: endDate, startTime: s.time, endTime: e.time };
}

function text(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function categoriesOf(comp: ICAL.Component): string[] {
  return comp
    .getAllProperties("categories")
    .flatMap((p) => p.getValues())
    .filter((v): v is string => typeof v === "string");
}

/**
 * Parse ICS text into flat, date-based items. Recurring events are expanded
 * between `from` and `until`; overridden occurrences (RECURRENCE-ID) replace
 * the generated ones; cancelled events are dropped.
 */
export function parseIcs(icsText: string, opts: ParseOptions): ParseResult {
  const root = new ICAL.Component(ICAL.parse(icsText));
  const vcal = root.name === "vcalendar" ? root : root.getFirstSubcomponent("vcalendar") ?? root;

  for (const tz of vcal.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      // Ignore malformed timezone definitions; times fall back to floating.
    }
  }

  const max = opts.maxOccurrences ?? 1000;
  const items: ParsedItem[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  const masters = new Map<string, ICAL.Component>();
  const exceptions = new Map<string, ICAL.Component[]>();
  let anonymous = 0;
  for (const comp of vcal.getAllSubcomponents("vevent")) {
    const uid = text(comp.getFirstPropertyValue("uid")) ?? `no-uid-${anonymous++}`;
    if (comp.hasProperty("recurrence-id")) {
      exceptions.set(uid, [...(exceptions.get(uid) ?? []), comp]);
    } else if (!masters.has(uid)) {
      masters.set(uid, comp);
    }
  }

  const push = (key: string, comp: ICAL.Component, start: ICAL.Time, end: ICAL.Time | null) => {
    const status = text(comp.getFirstPropertyValue("status"));
    if (status?.toUpperCase() === "CANCELLED") {
      skipped++;
      return;
    }
    const range = toRange(start, end);
    if (range.end < opts.from || range.start > opts.until) return;
    if (seen.has(key)) return;
    seen.add(key);
    const title = text(comp.getFirstPropertyValue("summary")) ?? "(untitled)";
    const item: ParsedItem = {
      externalKey: key,
      title,
      ...range,
      category: detectCategory(title, opts.defaultCategory, categoriesOf(comp)),
    };
    const description = text(comp.getFirstPropertyValue("description"));
    const location = text(comp.getFirstPropertyValue("location"));
    if (description) item.description = description.slice(0, 2000);
    if (location) item.location = location;
    if (!item.startTime) delete item.startTime;
    if (!item.endTime) delete item.endTime;
    items.push(item);
  };

  const untilTime = ICAL.Time.fromDateString(addDays(opts.until, 1));

  for (const [uid, master] of masters) {
    const event = new ICAL.Event(master);
    if (!event.startDate) {
      skipped++;
      continue;
    }
    if (!event.isRecurring()) {
      push(uid, master, event.startDate, event.endDate);
      continue;
    }
    for (const exc of exceptions.get(uid) ?? []) event.relateException(exc);
    const it = event.iterator();
    let count = 0;
    for (let next = it.next(); next; next = it.next()) {
      if (next.compare(untilTime) >= 0 || count++ >= max) break;
      const details = event.getOccurrenceDetails(next);
      push(
        `${uid}::${details.recurrenceId.toString()}`,
        details.item.component,
        details.startDate,
        details.endDate,
      );
    }
  }

  // Overrides whose master is missing from the feed.
  for (const [uid, comps] of exceptions) {
    if (masters.has(uid)) continue;
    for (const comp of comps) {
      const ev = new ICAL.Event(comp);
      push(`${uid}::${ev.recurrenceId!.toString()}`, comp, ev.startDate, ev.endDate);
    }
  }

  const calendarName = text(vcal.getFirstPropertyValue("x-wr-calname"));
  items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return { items, calendarName, skipped };
}
