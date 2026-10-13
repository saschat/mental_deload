import { describe, expect, it } from "vitest";
import { ideaTargets, resolveTarget, WEEKENDS_AHEAD } from "./ideaTargets";
import type { FamilyEvent } from "./types";

function ev(id: string, title: string, category: FamilyEvent["category"], start: string, end: string): FamilyEvent {
  return { id, title, category, start, end, kidIds: [], segments: [], createdAt: "", updatedAt: "" };
}

// Tuesday 13 Oct 2026.
const today = "2026-10-13";
const events = [
  ev("h1", "Herbstferien", "vacation", "2026-10-05", "2026-10-16"),
  ev("h2", "Sportferien", "vacation", "2027-02-15", "2027-02-26"),
  ev("old", "Sommerferien", "vacation", "2026-07-11", "2026-08-16"),
  ev("w1", "Weekend", "weekend", "2026-10-24", "2026-10-25"),
  ev("s1", "Schulreise", "school", "2026-10-20", "2026-10-20"),
];

describe("ideaTargets", () => {
  it("lists upcoming holidays from today and the next weekends", () => {
    const { vacations, weekends } = ideaTargets(events, today);
    expect(vacations.map((t) => [t.title, t.start, t.end])).toEqual([
      ["Herbstferien", "2026-10-13", "2026-10-16"],
      ["Sportferien", "2027-02-15", "2027-02-26"],
    ]);
    expect(weekends).toHaveLength(WEEKENDS_AHEAD);
    expect(weekends[0]).toMatchObject({ key: "weekend:2026-10-17", title: "This weekend", start: "2026-10-17", end: "2026-10-18" });
    expect(weekends[1]).toMatchObject({ title: "Next weekend", eventId: "w1" });
    expect(weekends[2].title).toBe("Weekend 31 Oct–1 Nov");
  });

  it("names the holiday a weekend falls in", () => {
    const { weekends } = ideaTargets(events, "2027-02-01");
    expect(weekends.find((t) => t.start === "2027-02-20")?.sub).toBe("Sportferien");
  });
});

describe("resolveTarget", () => {
  it("maps keys to targets and falls back to this weekend", () => {
    expect(resolveTarget("event:h2", events, today)).toMatchObject({ kind: "vacation", title: "Sportferien" });
    expect(resolveTarget("event:w1", events, today)).toMatchObject({ kind: "weekend", key: "weekend:2026-10-24", eventId: "w1" });
    expect(resolveTarget("event:s1", events, today)).toMatchObject({ kind: "event", eventId: "s1" });
    expect(resolveTarget("weekend:2026-11-07", events, today)).toMatchObject({ start: "2026-11-07", end: "2026-11-08" });
    expect(resolveTarget("event:old", events, today).key).toBe("weekend:2026-10-17");
    expect(resolveTarget(undefined, events, today).key).toBe("weekend:2026-10-17");
  });
});
