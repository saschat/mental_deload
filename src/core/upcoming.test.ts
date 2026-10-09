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
  it("does not filter by category", () => {
    for (const category of ["school", "vacation", "birthday", "weekend", "other"] as const) {
      expect(matchesUpcomingFilter(ev(category), kids, "upcoming")).toBe(true);
    }
  });

  it("hides fully not-relevant events on the upcoming scope and shows them on all", () => {
    const hidden = ev("weekend", { a: "not_relevant", b: "not_relevant" });
    expect(matchesUpcomingFilter(hidden, kids, "upcoming")).toBe(false);
    expect(matchesUpcomingFilter(hidden, kids, "all")).toBe(true);
  });

  it("undecided scope keeps only open coverage", () => {
    expect(matchesUpcomingFilter(ev("school"), kids, "undecided")).toBe(true);
    expect(matchesUpcomingFilter(ev("school", { a: "childcare", b: "childcare" }), kids, "undecided")).toBe(false);
  });

  it("kid scope keeps events relevant to that kid", () => {
    const onlyB = { ...ev("vacation"), kidIds: ["b"] };
    expect(matchesUpcomingFilter(onlyB, kids, "b")).toBe(true);
    expect(matchesUpcomingFilter(onlyB, kids, "a")).toBe(false);
  });
});
