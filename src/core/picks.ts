// A short list of ideas worth looking at first, chosen by a score rather than
// a sort: what happens on the dates or suits the season, how close it is, how
// many sources list it, how much the listing says, the weather, and variety.

import { activityCategory, hasId, listings, travelMinutes, type Activity, type ActivityCategory, type ActivityDate, type DatedIdea, type Ideas } from "./activities";

export interface Pick {
  activity: Activity;
  /** Dates in the range, for events. */
  dates?: ActivityDate[];
}

export interface PickOptions {
  start: string;
  end: string;
  /** Chance of rain on the dates in percent, when known. */
  rain?: number;
  favorites?: ReadonlySet<string>;
  /** Activity ids snoozed for these dates: never picked. */
  snoozed?: ReadonlySet<string>;
  /** How many earlier weekends or holidays each idea was a pick for, by activity id. */
  shownBefore?: ReadonlyMap<string, number>;
  count?: number;
}

/** Events among the picks at most, so places get a look in too. */
const MAX_EVENTS = 3;

function score(a: Activity, o: PickOptions, dates?: ActivityDate[]): number {
  let s = 0;
  const favorite = hasId(a, o.favorites);
  if (favorite) s += 3;
  if (dates) {
    // On the dates themselves, not a months-long run that merely overlaps them.
    if (dates.some((d) => d.start >= o.start && (d.end ?? d.start) <= o.end)) s += 2;
  } else if (a.months?.length && a.months.length < 12) s += 1;
  // Several sources listing the same place or event is a sign it is worth it.
  s += 0.75 * Math.min(3, listings(a).length - 1);
  const t = travelMinutes(a);
  s -= t ? t.minutes / 30 : 1.5;
  // Thin listings: no town, no kind, or a bare facility from OpenStreetMap.
  if (!a.place && !a.also?.length) s -= 1;
  if (a.kind === "Outing") s -= 0.5;
  if (listings(a).every((l) => l.source === "osm")) s -= 1.5;
  if (o.rain !== undefined) {
    if (o.rain >= 60) s += a.setting === "outdoor" ? -2 : a.setting === "indoor" ? 1 : 0;
    else if (o.rain <= 25 && a.setting === "outdoor") s += 0.5;
  }
  // After two weekends as a pick without being marked, make room for others.
  if (!favorite) s -= 1.5 * Math.max(0, (o.shownBefore?.get(a.id) ?? 0) - 1);
  return s;
}

/** Up to `count` ideas (6 by default), best first, at most one per category while others are left. */
export function pickIdeas(ideas: Ideas, o: PickOptions): Pick[] {
  const count = o.count ?? 6;
  const awake = (a: Activity) => !hasId(a, o.snoozed);
  const scored = [
    ...ideas.dated
      .filter((d: DatedIdea) => d.activity.booking !== "closed" && awake(d.activity))
      .map((d) => ({ pick: { activity: d.activity, dates: d.dates }, s: score(d.activity, o, d.dates) })),
    ...ideas.places.filter(awake).map((a) => ({ pick: { activity: a } as Pick, s: score(a, o) })),
  ].sort((x, y) => y.s - x.s || x.pick.activity.title.localeCompare(y.pick.activity.title));
  const out: Pick[] = [];
  const categories = new Set<ActivityCategory>();
  let events = 0;
  for (const varied of [true, false]) {
    for (const { pick } of scored) {
      if (out.length >= count) return out;
      if (out.includes(pick) || (pick.dates && events >= MAX_EVENTS)) continue;
      const category = activityCategory(pick.activity);
      if (varied && categories.has(category)) continue;
      out.push(pick);
      categories.add(category);
      if (pick.dates) events += 1;
    }
  }
  return out;
}

/** Activity id → start dates of the weekends and holidays it was a pick for. */
export type PickHistory = Record<string, string[]>;

/** Days a pick is remembered. */
const HISTORY_DAYS = 56;

/** How many weekends or holidays before `start` each idea was a pick for. */
export function shownBefore(history: PickHistory, start: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, starts] of Object.entries(history)) {
    const n = starts.filter((s) => s < start).length;
    if (n) out.set(id, n);
  }
  return out;
}

/** The history with `ids` noted as picks for `start`, forgetting dates more than eight weeks before `today`. */
export function rememberPicks(history: PickHistory, start: string, ids: readonly string[], today: string): PickHistory {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const out: PickHistory = {};
  for (const [id, starts] of Object.entries(history)) {
    const kept = starts.filter((s) => s >= cutoff);
    if (kept.length) out[id] = kept;
  }
  for (const id of ids) if (!out[id]?.includes(start)) out[id] = [...(out[id] ?? []), start].sort();
  return out;
}
