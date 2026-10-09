import { describe, expect, it } from "vitest";
import { addDays, addMonths, HORIZON_MONTHS, weekday } from "./dates";
import { normalizeSettings } from "./defaults";
import type { FamilyEvent, Task } from "./types";
import { planWeekends, upcomingSaturday, weekendItems, WEEKEND_TITLE } from "./weekends";

describe("weekendItems", () => {
  it("includes each Saturday in a known range and skips weekdays", () => {
    // 2026-10-09 is a Friday. Horizon end 2026-11-01 is the Sunday after 2026-10-31.
    const items = weekendItems("2026-10-09", "2026-11-01");
    expect(items.map((i) => [i.start, i.end])).toEqual([
      ["2026-10-10", "2026-10-11"],
      ["2026-10-17", "2026-10-18"],
      ["2026-10-24", "2026-10-25"],
      ["2026-10-31", "2026-11-01"],
    ]);
    expect(items.every((i) => weekday(i.start) === 6)).toBe(true);
    expect(items.every((i) => i.end === addDays(i.start, 1) && weekday(i.end) === 0)).toBe(true);
    expect(items.map((i) => i.start)).not.toContain("2026-10-09");
    expect(items.map((i) => i.start)).not.toContain("2026-10-12");
    expect(new Set(items.map((i) => i.externalKey)).size).toBe(items.length);
    expect(items.every((i) => i.externalKey === i.start && i.title === WEEKEND_TITLE && i.category === "weekend")).toBe(true);
    expect(items.every((i) => i.startTime === undefined && i.endTime === undefined)).toBe(true);
  });

  it("starts today when today is Saturday, and the next Saturday otherwise", () => {
    expect(upcomingSaturday("2026-10-10")).toBe("2026-10-10");
    expect(weekendItems("2026-10-10", "2026-10-10").map((i) => i.start)).toEqual(["2026-10-10"]);
    // Sunday: the weekend that started yesterday is already in the past.
    expect(upcomingSaturday("2026-10-11")).toBe("2026-10-17");
    expect(weekendItems("2026-10-11", "2026-10-25").map((i) => i.start)).toEqual(["2026-10-17", "2026-10-24"]);
    expect(weekendItems("2026-01-01", "2026-01-20").map((i) => i.start)).toEqual(["2026-01-03", "2026-01-10", "2026-01-17"]);
  });

  it("uses the same 18-month horizon as the ICS importer", () => {
    const today = "2026-10-09";
    const until = addMonths(today, HORIZON_MONTHS);
    expect(HORIZON_MONTHS).toBe(18);
    expect(until).toBe("2028-04-09");
    const items = weekendItems(today, until);
    const last = items[items.length - 1].start;
    expect(items[0].start).toBe("2026-10-10");
    expect(last <= until).toBe(true);
    expect(addDays(last, 7) > until).toBe(true);
    expect(weekday(last)).toBe(6);
  });
});

describe("planWeekends", () => {
  const source = { id: "weekends", kidIds: [] as string[] };
  const now = "2026-10-09T12:00:00.000Z";
  const today = "2026-10-09";
  const until = "2026-11-01";

  function apply(existing: FamilyEvent[], plan: ReturnType<typeof planWeekends>): FamilyEvent[] {
    const removed = new Set(plan.remove);
    const updated = new Map(plan.update.map((u) => [u.id, u.patch]));
    const kept = existing
      .filter((e) => !removed.has(e.id))
      .map((e) => (updated.has(e.id) ? { ...e, ...updated.get(e.id) } : e));
    return [...kept, ...plan.create];
  }

  it("creates one event per weekend and does not duplicate existing keys", () => {
    const plan1 = planWeekends({ source, existing: [], tasks: [], today, until, now });
    expect(plan1.create).toHaveLength(4);
    expect(plan1.create.every((e) => e.sourceId === "weekends" && e.kidIds.length === 0 && e.segments.length === 0)).toBe(true);
    expect(plan1.create.map((e) => e.externalKey)).toEqual(["2026-10-10", "2026-10-17", "2026-10-24", "2026-10-31"]);

    const existing = apply([], plan1);
    const plan2 = planWeekends({ source, existing, tasks: [], today, until, now });
    expect(plan2.create).toEqual([]);
    expect(plan2.update).toEqual([]);
    expect(plan2.remove).toEqual([]);
    expect(plan2.flagChanged).toEqual([]);
    expect(plan2.unchanged).toBe(4);

    const keys = new Set(existing.map((e) => e.externalKey));
    const extended = planWeekends({ source, existing, tasks: [], today, until: "2026-11-15", now });
    expect(extended.create.map((e) => e.start)).toEqual(["2026-11-07", "2026-11-14"]);
    expect(extended.create.every((e) => !keys.has(e.externalKey))).toBe(true);
    expect(extended.remove).toEqual([]);
    const merged = [...existing.map((e) => e.externalKey), ...extended.create.map((e) => e.externalKey)];
    expect(new Set(merged).size).toBe(merged.length);
  });

  it("does not reset statuses or tasks on weekends that already exist", () => {
    const plan1 = planWeekends({ source, existing: [], tasks: [], today, until, now });
    const existing = apply([], plan1);
    const decided = existing[0];
    decided.segments = [
      {
        id: "seg",
        start: decided.start,
        end: decided.end,
        statuses: { a: "not_relevant", b: "not_relevant" },
      },
    ];
    const withTask = existing[1];
    const tasks: Task[] = [
      { id: "task-1", eventId: withTask.id, title: "Plan the outing", done: false, order: 0 },
    ];

    const plan2 = planWeekends({ source, existing, tasks, today, until, now });
    expect(plan2.create).toEqual([]);
    expect(plan2.update).toEqual([]);
    expect(plan2.remove).toEqual([]);
    expect(plan2.flagChanged).toEqual([]);
    expect(plan2.flagRemoved).toEqual([]);
    expect(existing[0].segments[0].statuses).toEqual({ a: "not_relevant", b: "not_relevant" });
    expect(tasks[0].title).toBe("Plan the outing");
  });

  it("keeps already-imported weekends whose Saturday is now in the past", () => {
    const created = planWeekends({ source, existing: [], tasks: [], today: "2026-10-09", until, now }).create;
    const current = created.find((e) => e.start === "2026-10-10")!;
    const plan = planWeekends({
      source,
      existing: [current],
      tasks: [],
      today: "2026-10-11",
      until,
      now: "2026-10-11T12:00:00.000Z",
    });
    expect(plan.remove).toEqual([]);
    expect(plan.flagRemoved).toEqual([]);
    expect(plan.create.some((e) => e.start === "2026-10-10")).toBe(false);
    expect(plan.create[0]?.start).toBe("2026-10-17");
  });
});

describe("weekend reminder defaults", () => {
  it("fills close-in tiers when stored settings predate the category", () => {
    const stored = normalizeSettings({
      reminderTiers: {
        school: { tiers: [1], repeatEveryDays: 9 },
        vacation: { tiers: [180, 90, 30], repeatEveryDays: 7 },
        birthday: { tiers: [21, 7], repeatEveryDays: 2 },
        other: { tiers: [180, 90, 30], repeatEveryDays: 7 },
      } as never,
    });
    expect(stored.reminderTiers.weekend).toEqual({ tiers: [14, 3], repeatEveryDays: 0 });
    expect(stored.reminderTiers.school).toEqual({ tiers: [1], repeatEveryDays: 9 });
  });
});
