import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import { defaultReminderTiers } from "./defaults";
import { activeReminders, activeTier, dueReminders, pruneSent, reminderSchedule, toNotifications } from "./reminders";
import type { FamilyEvent, Task } from "./types";

const settings = { reminderTiers: defaultReminderTiers(), taskDueSoonDays: 3 };
const kids = [{ id: "a" }, { id: "b" }];
const standard = settings.reminderTiers.school;
const birthday = settings.reminderTiers.birthday;

function event(id: string, start: string, extra: Partial<FamilyEvent> = {}): FamilyEvent {
  return {
    id,
    title: `Event ${id}`,
    start,
    end: start,
    category: "school",
    kidIds: [],
    segments: [],
    createdAt: "",
    updatedAt: "",
    ...extra,
  };
}

describe("activeTier", () => {
  it("returns the most recently crossed tier", () => {
    expect(activeTier(200, standard)).toBeNull();
    expect(activeTier(180, standard)).toBe("t180");
    expect(activeTier(120, standard)).toBe("t180");
    expect(activeTier(90, standard)).toBe("t90");
    expect(activeTier(31, standard)).toBe("t90");
    expect(activeTier(30, standard)).toBe("t30");
    expect(activeTier(24, standard)).toBe("t30");
  });

  it("repeats weekly after the smallest tier", () => {
    expect(activeTier(23, standard)).toBe("r1");
    expect(activeTier(16, standard)).toBe("r2");
    expect(activeTier(2, standard)).toBe("r4");
    expect(activeTier(0, standard)).toBe("r4");
    expect(activeTier(-1, standard)).toBeNull();
  });

  it("uses close-in weekend tiers and does not repeat after them", () => {
    const weekend = settings.reminderTiers.weekend;
    expect(weekend).toEqual({ tiers: [14, 3], repeatEveryDays: 0 });
    expect(activeTier(20, weekend)).toBeNull();
    expect(activeTier(14, weekend)).toBe("t14");
    expect(activeTier(4, weekend)).toBe("t14");
    expect(activeTier(3, weekend)).toBe("t3");
    expect(activeTier(0, weekend)).toBe("t3");
  });

  it("uses birthday tiers with 2-day repeats", () => {
    expect(activeTier(30, birthday)).toBeNull();
    expect(activeTier(21, birthday)).toBe("t21");
    expect(activeTier(7, birthday)).toBe("t7");
    expect(activeTier(5, birthday)).toBe("r1");
    expect(activeTier(4, birthday)).toBe("r1");
    expect(activeTier(3, birthday)).toBe("r2");
  });
});

describe("reminderSchedule", () => {
  it("lists future firing dates", () => {
    const s = reminderSchedule("2026-03-01", birthday, "2026-02-01");
    expect(s).toEqual([
      "2026-02-08",
      "2026-02-22",
      "2026-02-24",
      "2026-02-26",
      "2026-02-28",
    ]);
  });
});

describe("activeReminders / dueReminders", () => {
  const today = "2026-01-01";

  it("reminds about undecided events only", () => {
    const undecided = event("u", addDays(today, 20));
    const decided = event("d", addDays(today, 20), {
      segments: [{ id: "s", start: addDays(today, 20), end: addDays(today, 20), statuses: { a: "attending", b: "attending" } }],
    });
    const far = event("f", addDays(today, 400));
    const past = event("p", addDays(today, -2));
    const r = activeReminders({ events: [undecided, decided, far, past], tasks: [], kids, settings, today });
    expect(r.map((x) => x.eventId)).toEqual(["u"]);
    expect(r[0].key).toBe(`ev:u:${undecided.start}:r1`);
  });

  it("does not resend already-sent keys, but sends the next tier", () => {
    const e = event("u", addDays(today, 30));
    const input = { events: [e], tasks: [], kids, settings, today };
    const first = dueReminders(input, new Set());
    expect(first).toHaveLength(1);
    const sent = new Set(first.map((r) => r.key));
    expect(dueReminders(input, sent)).toHaveLength(0);
    const later = { ...input, today: addDays(today, 7) };
    expect(dueReminders(later, sent)).toHaveLength(1);
  });

  it("re-arms when the event date changes", () => {
    const e = event("u", addDays(today, 30));
    const sent = new Set(dueReminders({ events: [e], tasks: [], kids, settings, today }, new Set()).map((r) => r.key));
    const moved = { ...e, start: addDays(today, 29), end: addDays(today, 29) };
    expect(dueReminders({ events: [moved], tasks: [], kids, settings, today }, sent)).toHaveLength(1);
  });

  it("reminds about overdue and due-soon tasks", () => {
    const e = event("e", addDays(today, 100), {
      segments: [{ id: "s", start: addDays(today, 100), end: addDays(today, 100), statuses: { a: "camp", b: "camp" } }],
    });
    const tasks: Task[] = [
      { id: "t1", eventId: "e", segmentId: "s", status: "camp", title: "Late", due: addDays(today, -1), done: false, order: 0 },
      { id: "t2", eventId: "e", segmentId: "s", status: "camp", title: "Soon", due: addDays(today, 2), done: false, order: 1 },
      { id: "t3", eventId: "e", segmentId: "s", status: "camp", title: "Later", due: addDays(today, 10), done: false, order: 2 },
      { id: "t4", eventId: "e", segmentId: "s", status: "camp", title: "Done", due: addDays(today, -1), done: true, order: 3 },
      { id: "t5", eventId: "gone", title: "Orphan", due: addDays(today, -1), done: false, order: 4 },
    ];
    const r = activeReminders({ events: [e], tasks, kids, settings, today });
    expect(r.map((x) => [x.taskId, x.kind])).toEqual([
      ["t1", "task-overdue"],
      ["t2", "task-soon"],
    ]);
    expect(r[0].title).toBe("Overdue: Late for Holiday camp");
    expect(r[1].title).toBe("Due in 2 days: Soon for Holiday camp");
  });

  it("names a coverage in due and overdue lines", () => {
    const e = event("e", addDays(today, 10), {
      title: "Holiday X",
      segments: [
        {
          id: "s",
          name: "Ibiza",
          start: addDays(today, 10),
          end: addDays(today, 10),
          statuses: { a: "vacation", b: "vacation" },
        },
      ],
    });
    const tasks: Task[] = [
      { id: "t1", eventId: "e", segmentId: "s", status: "vacation", title: "pack", due: today, done: false, order: 0 },
    ];
    const r = activeReminders({ events: [e], tasks, kids, settings, today });
    expect(r.map((x) => x.title)).toEqual(["Due today: pack for Ibiza"]);
    expect(r[0].body).toBe('For "Holiday X - Ibiza".');
  });
});

describe("toNotifications", () => {
  it("summarises many reminders into one notification", () => {
    const events = [1, 2, 3, 4].map((i) => event(String(i), addDays("2026-01-01", 10 + i)));
    const r = activeReminders({ events, tasks: [], kids, settings, today: "2026-01-01" });
    expect(toNotifications(r.slice(0, 2))).toHaveLength(2);
    const n = toNotifications(r);
    expect(n).toHaveLength(1);
    expect(n[0].body).toContain("4 events need a decision");
  });
});

describe("pruneSent", () => {
  it("drops keys of deleted events and finished tasks", () => {
    const e = event("e", "2026-02-01");
    const tasks: Task[] = [{ id: "t", eventId: "e", title: "x", done: true, order: 0 }];
    const out = pruneSent(["ev:e:2026-02-01:t30", "ev:x:2026-02-01:t30", "task:t:soon:2026-01-02"], {
      events: [e],
      tasks,
      kids,
      settings,
      today: "2026-01-01",
    });
    expect(out).toEqual(["ev:e:2026-02-01:t30"]);
  });
});
