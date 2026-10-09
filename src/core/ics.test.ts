import { describe, expect, it } from "vitest";
import { buildRemindersIcs } from "./icsExport";
import { detectCategory, parseIcs } from "./icsParse";
import { acceptUpstream, ignoreUpstream, planImport, summarize } from "./importDiff";
import { defaultReminderTiers } from "./defaults";
import type { FamilyEvent, Task } from "./types";

function cal(...events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    "X-WR-CALNAME:School",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}

const SUMMER = [
  "BEGIN:VEVENT",
  "UID:summer@school",
  "DTSTART;VALUE=DATE:20260720",
  "DTEND;VALUE=DATE:20260901",
  "SUMMARY:Sommerferien",
  "END:VEVENT",
].join("\r\n");

const PARENTS_EVENING = [
  "BEGIN:VEVENT",
  "UID:pe@school",
  "DTSTART:20260310T180000Z",
  "DTEND:20260310T193000Z",
  "SUMMARY:Parents evening",
  "LOCATION:Room 4",
  "END:VEVENT",
].join("\r\n");

const WEEKLY = [
  "BEGIN:VEVENT",
  "UID:swim@club",
  "DTSTART;VALUE=DATE:20260105",
  "DTEND;VALUE=DATE:20260106",
  "RRULE:FREQ=WEEKLY;COUNT=4",
  "SUMMARY:Swimming",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:swim@club",
  "RECURRENCE-ID;VALUE=DATE:20260112",
  "DTSTART;VALUE=DATE:20260113",
  "DTEND;VALUE=DATE:20260114",
  "SUMMARY:Swimming (moved)",
  "END:VEVENT",
].join("\r\n");

const CANCELLED = [
  "BEGIN:VEVENT",
  "UID:x@school",
  "DTSTART;VALUE=DATE:20260401",
  "SUMMARY:Trip",
  "STATUS:CANCELLED",
  "END:VEVENT",
].join("\r\n");

const opts = { from: "2026-01-01", until: "2027-06-30", defaultCategory: "school" as const };

describe("parseIcs", () => {
  it("parses all-day events with exclusive DTEND and detects vacation", () => {
    const r = parseIcs(cal(SUMMER), opts);
    expect(r.calendarName).toBe("School");
    expect(r.items).toEqual([
      { externalKey: "summer@school", title: "Sommerferien", start: "2026-07-20", end: "2026-08-31", category: "vacation" },
    ]);
  });

  it("parses timed events in local time", () => {
    const [item] = parseIcs(cal(PARENTS_EVENING), opts).items;
    expect(item.start).toBe("2026-03-10");
    expect(item.startTime).toMatch(/^\d\d:\d\d$/);
    expect(item.location).toBe("Room 4");
    expect(item.category).toBe("school");
  });

  it("expands recurrences and applies RECURRENCE-ID overrides", () => {
    const r = parseIcs(cal(WEEKLY), opts);
    expect(r.items.map((i) => [i.start, i.title])).toEqual([
      ["2026-01-05", "Swimming"],
      ["2026-01-13", "Swimming (moved)"],
      ["2026-01-19", "Swimming"],
      ["2026-01-26", "Swimming"],
    ]);
    expect(new Set(r.items.map((i) => i.externalKey)).size).toBe(4);
    expect(r.items[1].externalKey).toBe("swim@club::2026-01-12");
  });

  it("limits to the horizon and drops cancelled events", () => {
    const r = parseIcs(cal(WEEKLY, CANCELLED), { ...opts, from: "2026-01-15", until: "2026-01-20" });
    expect(r.items.map((i) => i.start)).toEqual(["2026-01-19"]);
    expect(r.skipped).toBe(1);
  });

  it("caps unbounded recurrences at the horizon", () => {
    const infinite = WEEKLY.replace("RRULE:FREQ=WEEKLY;COUNT=4", "RRULE:FREQ=WEEKLY");
    const r = parseIcs(cal(infinite), { ...opts, until: "2026-03-01" });
    expect(r.items.length).toBe(8);
  });
});

describe("detectCategory", () => {
  it("recognises birthdays and holidays", () => {
    expect(detectCategory("Mia's birthday party", "other")).toBe("birthday");
    expect(detectCategory("Kindergeburtstag Paul", "other")).toBe("birthday");
    expect(detectCategory("Herbstferien", "school")).toBe("vacation");
    expect(detectCategory("Half-term break", "school")).toBe("vacation");
    expect(detectCategory("Sports day", "auto")).toBe("other");
    expect(detectCategory("Sports day", "school")).toBe("school");
  });
});

describe("planImport", () => {
  const source = { id: "src", kidIds: ["a", "b"] };
  const base = { source, tasks: [] as Task[], from: "2026-01-01", until: "2027-06-30", now: "2026-01-01T00:00:00Z" };

  function apply(existing: FamilyEvent[], plan: ReturnType<typeof planImport>): FamilyEvent[] {
    let out = existing.filter((e) => !plan.remove.includes(e.id));
    out = out.map((e) => {
      const u = plan.update.find((x) => x.id === e.id);
      const c = plan.flagChanged.find((x) => x.id === e.id);
      if (u) e = { ...e, ...u.patch };
      if (c) e = { ...e, upstreamFlag: "changed", upstreamPending: c.pending };
      if (plan.flagRemoved.includes(e.id)) e = { ...e, upstreamFlag: "removed" };
      return e;
    });
    return [...out, ...plan.create];
  }

  it("creates new events and is idempotent on re-import", () => {
    const parsed = parseIcs(cal(SUMMER, PARENTS_EVENING, WEEKLY), opts).items;
    const plan1 = planImport({ ...base, existing: [], parsed });
    expect(summarize(plan1)).toMatchObject({ created: 6, updated: 0, flagged: 0, removed: 0 });
    expect(plan1.create[0]).toMatchObject({ sourceId: "src", kidIds: ["a", "b"], segments: [] });

    const events = apply([], plan1);
    const plan2 = planImport({ ...base, existing: events, parsed });
    expect(summarize(plan2)).toEqual({ created: 0, updated: 0, flagged: 0, removed: 0, unchanged: 6 });
  });

  it("silently updates and deletes undecided events", () => {
    const events = apply([], planImport({ ...base, existing: [], parsed: parseIcs(cal(SUMMER, PARENTS_EVENING), opts).items }));
    const moved = SUMMER.replace("20260720", "20260721").replace("Sommerferien", "Summer holidays");
    const plan = planImport({ ...base, existing: events, parsed: parseIcs(cal(moved), opts).items });
    expect(summarize(plan)).toMatchObject({ created: 0, updated: 1, flagged: 0, removed: 1 });
    const after = apply(events, plan);
    expect(after.find((e) => e.externalKey === "summer@school")).toMatchObject({ start: "2026-07-21", title: "Summer holidays" });
  });

  it("flags decided events instead of changing or deleting them", () => {
    const parsed = parseIcs(cal(SUMMER, PARENTS_EVENING), opts).items;
    let events = apply([], planImport({ ...base, existing: [], parsed }));
    events = events.map((e) => ({
      ...e,
      segments: [{ id: "s", start: e.start, end: e.end, statuses: { a: "grandparents" as const } }],
    }));
    const moved = SUMMER.replace("20260720", "20260727");
    const plan = planImport({ ...base, existing: events, parsed: parseIcs(cal(moved), opts).items });
    expect(plan.flagChanged).toHaveLength(1);
    expect(plan.flagChanged[0].pending.start).toBe("2026-07-27");
    expect(plan.flagRemoved).toHaveLength(1);
    expect(plan.remove).toHaveLength(0);
    expect(plan.update).toHaveLength(0);

    // Re-importing the same feed doesn't re-flag.
    const flagged = apply(events, plan);
    const again = planImport({ ...base, existing: flagged, parsed: parseIcs(cal(moved), opts).items });
    expect(summarize(again)).toMatchObject({ flagged: 0, updated: 0, unchanged: 2 });

    // Accepting applies upstream dates and clips segments.
    const summer = flagged.find((e) => e.externalKey === "summer@school")!;
    const accepted = acceptUpstream(summer, "now");
    expect(accepted).toMatchObject({ start: "2026-07-27", upstreamFlag: null, upstreamPending: null });
    expect(accepted.segments[0].start).toBe("2026-07-27");

    // Ignoring remembers the upstream version so it is not flagged again.
    const ignored = ignoreUpstream(summer, "now");
    expect(ignored.start).toBe("2026-07-20");
    const afterIgnore = planImport({ ...base, existing: [ignored], parsed: parseIcs(cal(moved), opts).items });
    expect(afterIgnore.flagChanged).toHaveLength(0);

    // Keeping a removed event detaches it from the source.
    const removed = flagged.find((e) => e.upstreamFlag === "removed")!;
    expect(ignoreUpstream(removed, "now").sourceId).toBeUndefined();
  });

  it("treats events with tasks as decided", () => {
    const events = apply([], planImport({ ...base, existing: [], parsed: parseIcs(cal(SUMMER), opts).items }));
    const tasks: Task[] = [{ id: "t", eventId: events[0].id, title: "x", done: false, order: 0 }];
    const plan = planImport({ ...base, tasks, existing: events, parsed: [] });
    expect(plan.flagRemoved).toEqual([events[0].id]);
  });

  it("clears the flag when a removed event reappears", () => {
    const events = apply([], planImport({ ...base, existing: [], parsed: parseIcs(cal(SUMMER), opts).items })).map(
      (e) => ({ ...e, upstreamFlag: "removed" as const, segments: [{ id: "s", start: e.start, end: e.end, statuses: { a: "camp" as const } }] }),
    );
    const plan = planImport({ ...base, existing: events, parsed: parseIcs(cal(SUMMER), opts).items });
    expect(plan.update).toEqual([{ id: events[0].id, patch: { upstreamFlag: null, upstreamPending: null } }]);
  });

  it("leaves past events and other sources alone", () => {
    const events = apply([], planImport({ ...base, existing: [], parsed: parseIcs(cal(SUMMER), opts).items }));
    const other = { ...events[0], id: "o", sourceId: "other" };
    const plan = planImport({ ...base, from: "2026-09-15", existing: [...events, other], parsed: [] });
    expect(summarize(plan)).toMatchObject({ removed: 0, flagged: 0 });
  });
});

describe("buildRemindersIcs", () => {
  it("exports undecided events and open tasks with alarms", () => {
    const ev: FamilyEvent = {
      id: "e1",
      title: "Autumn break, week 1",
      start: "2026-10-12",
      end: "2026-10-23",
      category: "vacation",
      kidIds: [],
      segments: [],
      createdAt: "",
      updatedAt: "",
    };
    const decided = {
      ...ev,
      id: "e2",
      title: "Holiday X",
      segments: [{ id: "s", start: ev.start, end: ev.end, statuses: { a: "camp" as const }, name: "Circus" }],
    };
    const tasks: Task[] = [
      { id: "t1", eventId: "e2", segmentId: "s", status: "camp", title: "Register & pay", due: "2026-10-10", done: false, order: 0 },
      { id: "t2", eventId: "e2", title: "Old", due: "2026-01-10", done: false, order: 1 },
    ];
    const ics = buildRemindersIcs({
      events: [ev, decided],
      tasks,
      kids: [{ id: "a" }],
      settings: { reminderTiers: defaultReminderTiers() },
      today: "2026-08-01",
      now: new Date("2026-08-01T10:00:00Z"),
    });
    expect(ics).toContain("UID:md-event-e1@mental-deload");
    expect(ics).not.toContain("md-event-e2");
    expect(ics).toContain("SUMMARY:Decide: Autumn break\\, week 1");
    expect(ics).toContain("DTEND;VALUE=DATE:20261024");
    expect(ics).toContain("TRIGGER:-P29DT15H");
    expect(ics).not.toContain("TRIGGER:-P179DT15H");
    expect(ics).toContain("UID:md-task-t1@mental-deload");
    expect(ics).toContain("SUMMARY:Holiday X - Circus: Register & pay for Circus");
    expect(ics).not.toContain("md-task-t2");

    // Round-trips through our own parser.
    const parsed = parseIcs(ics, { from: "2026-08-01", until: "2027-01-01", defaultCategory: "other" });
    expect(parsed.items.map((i) => i.externalKey).sort()).toEqual(["md-event-e1@mental-deload", "md-task-t1@mental-deload"]);
  });
});
