import { describe, expect, it } from "vitest";
import { matchesCategory, matchesInboxFilter } from "./inbox";
import type { Category, StatusKey } from "./types";

const kids = [{ id: "a" }, { id: "b" }];
const today = "2026-10-09";

function ev(category: Category, statuses?: Record<string, StatusKey>) {
  return {
    category,
    start: "2026-10-10",
    end: "2026-10-11",
    kidIds: [] as string[],
    segments: statuses ? [{ id: "s", start: "2026-10-10", end: "2026-10-11", statuses }] : [],
  };
}

describe("matchesInboxFilter", () => {
  it("shows every category when the category filter is empty", () => {
    const filter = { categories: [] as Category[] };
    for (const category of ["school", "vacation", "birthday", "weekend", "other"] as const) {
      expect(matchesInboxFilter(ev(category), kids, today, filter)).toBe(true);
    }
  });

  it("weekend and school together exclude vacation", () => {
    const filter = { categories: ["weekend", "school"] as const };
    expect(matchesInboxFilter(ev("weekend"), kids, today, filter)).toBe(true);
    expect(matchesInboxFilter(ev("school"), kids, today, filter)).toBe(true);
    expect(matchesInboxFilter(ev("vacation"), kids, today, filter)).toBe(false);
    expect(matchesInboxFilter(ev("birthday"), kids, today, filter)).toBe(false);
  });

  it("ANDs category chips with inbox membership", () => {
    const school = { categories: ["school"] as const };
    const decided = ev("school", { a: "childcare", b: "childcare" });
    const past = { ...ev("school"), end: "2026-10-01" };
    const flagged = { ...ev("school"), upstreamFlag: "changed" as const };
    const urgent = ev("school");
    const later = { ...ev("school"), start: "2027-06-01", end: "2027-06-02" };

    expect(matchesInboxFilter(decided, kids, today, school)).toBe(false);
    expect(matchesInboxFilter(past, kids, today, school)).toBe(false);
    expect(matchesInboxFilter(flagged, kids, today, school)).toBe(false);
    expect(matchesInboxFilter(urgent, kids, today, school)).toBe(true);
    expect(matchesInboxFilter(later, kids, today, school)).toBe(true);
    expect(matchesCategory("school", school.categories)).toBe(true);
    expect(matchesCategory("vacation", school.categories)).toBe(false);
  });
});
