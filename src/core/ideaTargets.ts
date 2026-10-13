/**
 * The weekend or holiday the Ideas page plans for: upcoming vacations from the
 * calendar plus the next weekends, whether or not a weekends source exists.
 */
import { weekendFrom } from "./activities";
import { addDays, formatDate, formatRange, maxDate } from "./dates";
import type { FamilyEvent, ISODate } from "./types";

export interface IdeaTarget {
  /** "event:<id>" or "weekend:<saturday>"; also the route query. */
  key: string;
  title: string;
  /** Dates and, for weekends, the holiday they fall in. */
  sub: string;
  /** From today when the target has already started. */
  start: ISODate;
  end: ISODate;
  kind: "vacation" | "weekend" | "event";
  /** Calendar event to add activities to; missing for a weekend without one. */
  eventId?: string;
}

/** How many weekends ahead the picker offers. */
export const WEEKENDS_AHEAD = 26;

function shortRange(start: ISODate, end: ISODate): string {
  if (start === end) return formatDate(start, { weekday: "short", day: "numeric", month: "short" });
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${formatDate(start, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" })}–${formatDate(end)}`;
}

function eventTarget(e: FamilyEvent, today: ISODate): IdeaTarget {
  const start = maxDate(e.start, today);
  return {
    key: `event:${e.id}`,
    title: e.title || formatRange(e.start, e.end),
    sub: formatRange(start, e.end),
    start,
    end: e.end,
    kind: e.category === "vacation" ? "vacation" : "event",
    eventId: e.id,
  };
}

export function weekendTarget(saturday: ISODate, events: readonly FamilyEvent[], today: ISODate): IdeaTarget {
  const thisSat = weekendFrom(today).start;
  const weeks = Math.round((Date.parse(saturday) - Date.parse(thisSat)) / (7 * 864e5));
  const end = addDays(saturday, 1);
  const event = events.find((e) => e.category === "weekend" && e.start === saturday);
  const holiday = events.find((e) => e.category === "vacation" && e.start <= end && e.end >= saturday);
  const dates = shortRange(saturday, end);
  const title = weeks === 0 ? "This weekend" : weeks === 1 ? "Next weekend" : `Weekend ${dates}`;
  return {
    key: `weekend:${saturday}`,
    title,
    sub: [weeks <= 1 ? dates : "", holiday?.title ?? ""].filter(Boolean).join(" · "),
    start: maxDate(saturday, today),
    end,
    kind: "weekend",
    eventId: event?.id,
  };
}

export function ideaTargets(events: readonly FamilyEvent[], today: ISODate): { vacations: IdeaTarget[]; weekends: IdeaTarget[] } {
  const vacations = events
    .filter((e) => e.category === "vacation" && e.end >= today)
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
    .map((e) => eventTarget(e, today));
  const weekends: IdeaTarget[] = [];
  for (let i = 0; i < WEEKENDS_AHEAD; i++) weekends.push(weekendTarget(weekendFrom(today, i).start, events, today));
  return { vacations, weekends };
}

/** The target for a route key; this weekend when the key is missing or stale. */
export function resolveTarget(key: string | undefined, events: readonly FamilyEvent[], today: ISODate): IdeaTarget {
  const [kind, value] = (key ?? "").split(/:(.*)/s);
  if (kind === "weekend" && /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") && addDays(value, 1) >= today) {
    return weekendTarget(value, events, today);
  }
  if (kind === "event") {
    const e = events.find((x) => x.id === value);
    if (e && e.end >= today) return e.category === "weekend" ? weekendTarget(e.start, events, today) : eventTarget(e, today);
  }
  return weekendTarget(weekendFrom(today).start, events, today);
}
