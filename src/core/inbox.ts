import { isUndecided } from "./coverage";
import type { Category, FamilyEvent, ISODate, Kid } from "./types";

export interface InboxFilter {
  /** Empty means every category. */
  categories: readonly Category[];
}

/** Category chips. An empty list does not narrow. */
export function matchesCategory(category: Category, categories: readonly Category[]): boolean {
  return categories.length === 0 || categories.includes(category);
}

/**
 * Needs-decision list. Category chips AND with inbox membership: the event is
 * still upcoming, still undecided, and not parked in the upstream section.
 */
export function matchesInboxFilter(
  event: Pick<FamilyEvent, "category" | "start" | "end" | "segments" | "kidIds" | "upstreamFlag">,
  kids: Pick<Kid, "id">[],
  today: ISODate,
  filter: InboxFilter,
): boolean {
  if (!matchesCategory(event.category, filter.categories)) return false;
  if (event.upstreamFlag) return false;
  if (event.end < today) return false;
  return isUndecided(event, kids);
}
