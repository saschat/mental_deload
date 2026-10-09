import { hiddenBecauseNotRelevant, isUndecided, relevantKidIds } from "./coverage";
import type { Category, FamilyEvent, Kid } from "./types";

/**
 * Scope chip on Upcoming. "upcoming" hides fully not-relevant events, "all"
 * shows them, "undecided" keeps only open coverage, and any other value is a
 * kid id.
 */
export type UpcomingScope = "upcoming" | "all" | "undecided" | (string & {});

export interface UpcomingFilter {
  scope: UpcomingScope;
  /** Empty means every category. */
  categories: readonly Category[];
}

/**
 * Upcoming list predicate. Category chips AND with the scope chip: an empty
 * category list does not narrow, and a fully not-relevant event stays hidden
 * while the scope is "upcoming".
 */
export function matchesUpcomingFilter(
  event: Pick<FamilyEvent, "category" | "start" | "end" | "segments" | "kidIds">,
  kids: Pick<Kid, "id">[],
  filter: UpcomingFilter,
): boolean {
  if (filter.categories.length > 0 && !filter.categories.includes(event.category)) return false;
  if (filter.scope === "all") return true;
  if (filter.scope === "undecided") return isUndecided(event, kids);
  if (filter.scope === "upcoming") return !hiddenBecauseNotRelevant(event, kids);
  return relevantKidIds(event, kids).includes(filter.scope);
}
