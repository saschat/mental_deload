import { hiddenBecauseNotRelevant, isUndecided, relevantKidIds } from "./coverage";
import type { FamilyEvent, Kid } from "./types";

/**
 * Scope chip on Upcoming. "upcoming" hides fully not-relevant events, "all"
 * shows them, "undecided" keeps only open coverage, and any other value is a
 * kid id. Category is not filtered here.
 */
export type UpcomingScope = "upcoming" | "all" | "undecided" | (string & {});

/**
 * Upcoming list predicate. A fully not-relevant event stays hidden while the
 * scope is "upcoming".
 */
export function matchesUpcomingFilter(
  event: Pick<FamilyEvent, "start" | "end" | "segments" | "kidIds">,
  kids: Pick<Kid, "id">[],
  scope: UpcomingScope,
): boolean {
  if (scope === "all") return true;
  if (scope === "undecided") return isUndecided(event, kids);
  if (scope === "upcoming") return !hiddenBecauseNotRelevant(event, kids);
  return relevantKidIds(event, kids).includes(scope);
}
