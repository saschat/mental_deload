import { addDays, weekday } from "./dates";
import { planImport, type ImportPlan } from "./importDiff";
import type { ParsedItem } from "./icsParse";
import type { FamilyEvent, ISODate, Source, Task } from "./types";

export const WEEKEND_TITLE = "Weekend";

/** Saturday on or after `today`. Today itself when today is Saturday. */
export function upcomingSaturday(today: ISODate): ISODate {
  const delta = (6 - weekday(today) + 7) % 7;
  return addDays(today, delta);
}

/**
 * One all-day item per weekend, Saturday through Sunday inclusive.
 * Starts at the upcoming Saturday and stops at the last Saturday on or before
 * `until` (the same horizon end the ICS importer uses). Past weekends are omitted.
 * `externalKey` is the Saturday date; together with the source id that is the dedupe key.
 */
export function weekendItems(today: ISODate, until: ISODate): ParsedItem[] {
  const items: ParsedItem[] = [];
  for (let sat = upcomingSaturday(today); sat <= until; sat = addDays(sat, 7)) {
    items.push({
      externalKey: sat,
      title: WEEKEND_TITLE,
      start: sat,
      end: addDays(sat, 1),
      category: "weekend",
    });
  }
  return items;
}

/**
 * Idempotent import plan for a weekends source. Re-running extends the horizon
 * and matches existing events by source id + Saturday. Statuses and tasks are
 * left in place (planImport never rewrites an invested event). Weekends whose
 * Saturday is already past are not regenerated and are kept out of the removal
 * window, so a re-run does not delete them.
 */
export function planWeekends(args: {
  source: Pick<Source, "id" | "kidIds">;
  existing: FamilyEvent[];
  tasks: Task[];
  today: ISODate;
  until: ISODate;
  now: string;
}): ImportPlan {
  const from = upcomingSaturday(args.today);
  return planImport({
    source: args.source,
    existing: args.existing,
    parsed: weekendItems(args.today, args.until),
    tasks: args.tasks,
    from,
    until: args.until,
    now: args.now,
  });
}
