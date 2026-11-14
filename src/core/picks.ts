// A short list of ideas worth looking at first, chosen by a score rather than
// a sort: what happens on the dates or suits the season, how close it is, how
// many sources list it, how much the listing says, the weather, and variety.

import { activityCategory, hasId, listings, travelMinutes, type Activity, type ActivityCategory, type ActivityDate } from "./activities";
import { entryId, type GroupedIdeas, type IdeaEntry, type IdeaItem } from "./groups";

export interface PickOptions {
  start: string;
  end: string;
  /** Chance of rain on the dates in percent, when known. */
  rain?: number;
  favorites?: ReadonlySet<string>;
  /** Activity and group ids snoozed for these dates: never picked. */
  snoozed?: ReadonlySet<string>;
  /** How many earlier weekends or holidays each idea was a pick for, by entryId. */
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
  return s;
}

/**
 * Up to `count` ideas (6 by default), best first, at most one per category while
 * others are left. A group counts as one idea, led by its best member.
 */
export function pickIdeas(ideas: GroupedIdeas, o: PickOptions): IdeaEntry[] {
  const count = o.count ?? 6;
  const scored: { entry: IdeaEntry; s: number }[] = [];
  for (const entry of [...ideas.dated, ...ideas.places]) {
    if (entry.group && o.snoozed?.has(entry.group.id)) continue;
    const items = entry.items
      .filter((i) => i.activity.booking !== "closed" && !hasId(i.activity, o.snoozed))
      .map((i) => ({ i, s: score(i.activity, o, i.dates) - rotation(entry, i, o) }))
      .sort((x, y) => y.s - x.s);
    if (items.length) scored.push({ entry: { ...entry, items: items.map((x) => x.i) }, s: items[0].s });
  }
  scored.sort((x, y) => y.s - x.s || x.entry.items[0].activity.title.localeCompare(y.entry.items[0].activity.title));
  const out: IdeaEntry[] = [];
  const categories = new Set<ActivityCategory>();
  let events = 0;
  for (const varied of [true, false]) {
    for (const { entry } of scored) {
      if (out.length >= count) return out;
      const lead = entry.items[0];
      if (out.includes(entry) || (lead.dates && events >= MAX_EVENTS)) continue;
      const category = activityCategory(lead.activity);
      if (varied && categories.has(category)) continue;
      out.push(entry);
      categories.add(category);
      if (lead.dates) events += 1;
    }
  }
  return out;
}

/** After two weekends as a pick without being marked, make room for others. */
function rotation(entry: IdeaEntry, item: IdeaItem, o: PickOptions): number {
  if (hasId(item.activity, o.favorites)) return 0;
  return 1.5 * Math.max(0, (o.shownBefore?.get(entryId(entry)) ?? 0) - 1);
}

/** Idea id (see entryId) → start dates of the weekends and holidays it was a pick for. */
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
