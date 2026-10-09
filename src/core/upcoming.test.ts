import { describe, expect, it } from "vitest";
import { matchesUpcomingFilter } from "./upcoming";
import type { Category, StatusKey } from "./types";

const kids = [{ id: "a" }, { id: "b" }];

function ev(category: Category, statuses?: Record<string, StatusKey>) {
  return {
    category,
    start: "2026-10-10",
    end: "2026-10-11",
    kidIds: [] as string[],
    segments: statuses ? [{ id: "s", start: "2026-10-10", end: "2026-10-11", statuses }] : [],
  };
}

describe("matchesUpcomingFilter", () => {
  it("shows every category when the category filter is empty", () => {
    const filter = { scope: "upcoming" as const, categories: [] };
    for (const category of ["school", "vacation", "birthday", "weekend", "other"] as const) {
      expect(matchesUpcomingFilter(ev(category), kids, filter)).toBe(true);
    }
  });

  it("weekend and school together exclude vacation", () => {
    const filter = { scope: "upcoming" as const, categories: ["weekend", "school"] as const };
    expect(matchesUpcomingFilter(ev("weekend"), kids, filter)).toBe(true);
    expect(matchesUpcomingFilter(ev("school"), kids, filter)).toBe(true);
    expect(matchesUpcomingFilter(ev("vacation"), kids, filter)).toBe(false);
    expect(matchesUpcomingFilter(ev("birthday"), kids, filter)).toBe(false);
  });

  it("still hides fully not-relevant events on the upcoming scope", () => {
    const hidden = ev("weekend", { a: "not_relevant", b: "not_relevant" });
    expect(matchesUpcomingFilter(hidden, kids, { scope: "upcoming", categories: [] })).toBe(false);
    expect(matchesUpcomingFilter(hidden, kids, { scope: "upcoming", categories: ["weekend"] })).toBe(false);
    expect(matchesUpcomingFilter(hidden, kids, { scope: "all", categories: ["weekend"] })).toBe(true);
    expect(matchesUpcomingFilter(hidden, kids, { scope: "all", categories: ["school"] })).toBe(false);
  });

  it("ANDs the category chips with a kid chip", () => {
    expect(matchesUpcomingFilter(ev("weekend"), kids, { scope: "a", categories: ["weekend"] })).toBe(true);
    expect(matchesUpcomingFilter(ev("weekend"), kids, { scope: "a", categories: ["school"] })).toBe(false);
  });
});
