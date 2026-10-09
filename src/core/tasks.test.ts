import { describe, expect, it } from "vitest";
import { defaultTemplates } from "./defaults";
import {
  buildTaskTree,
  flattenTree,
  generateTasks,
  pickTemplate,
  planSegmentTasks,
  taskActionLabel,
  taskContextLabel,
  taskCoverageName,
  taskExportSummary,
  taskGroup,
} from "./tasks";
import type { Segment, Task } from "./types";

const templates = defaultTemplates();
const event = { id: "e1", category: "vacation" as const };
const segment: Segment = { id: "s1", start: "2027-07-01", end: "2027-07-14", statuses: { a: "camp", b: "camp" } };
const kids = [
  { id: "a", name: "Mia" },
  { id: "b", name: "Leo" },
];

describe("pickTemplate", () => {
  it("prefers category-specific templates", () => {
    expect(pickTemplate(templates, "attending", "birthday")?.id).toBe("tpl-attending-birthday");
    expect(pickTemplate(templates, "attending", "school")?.id).toBe("tpl-attending");
    expect(pickTemplate(templates, "not_relevant", "school")).toBeUndefined();
  });
});

describe("generateTasks", () => {
  it("creates tasks with due dates relative to the segment start", () => {
    const tasks = generateTasks({ event, segment, status: "camp", templates, today: "2026-01-01" });
    expect(tasks.map((t) => [t.title, t.due])).toEqual([
      ["Find camp", "2027-03-03"],
      ["Register & pay", "2027-04-02"],
      ["Pack list", "2027-06-28"],
    ]);
    expect(tasks.every((t) => t.generated && t.segmentId === "s1" && t.status === "camp" && !t.done)).toBe(true);
  });

  it("clamps past due dates to today", () => {
    const tasks = generateTasks({ event, segment, status: "camp", templates, today: "2027-05-01" });
    expect(tasks.map((t) => t.due)).toEqual(["2027-05-01", "2027-05-01", "2027-06-28"]);
  });

  it("builds a hierarchy with parent links", () => {
    const tasks = generateTasks({ event, segment, status: "childcare", templates, today: "2026-01-01" });
    const root = tasks.find((t) => t.title === "Organize child care")!;
    expect(root.parentId).toBeNull();
    const children = tasks.filter((t) => t.parentId === root.id).map((t) => t.title);
    expect(children).toEqual(["Ask grandparents", "Book sitter", "Confirm"]);
    const tree = buildTaskTree(tasks);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(3);
    expect(flattenTree(tree).map((n) => n.depth)).toEqual([0, 1, 1, 1]);
  });
});

describe("planSegmentTasks", () => {
  const base = { event, kids, kidIds: ["a", "b"], templates, today: "2026-01-01" };

  it("creates one task set when kids share a status", () => {
    const plan = planSegmentTasks({ ...base, segment, tasks: [] });
    expect(plan.stale).toEqual([]);
    expect(plan.create.map((t) => t.title)).toEqual(["Find camp", "Register & pay", "Pack list"]);
  });

  it("creates per-status sets with kid names when kids differ", () => {
    const seg = { ...segment, statuses: { a: "camp" as const, b: "grandparents" as const } };
    const plan = planSegmentTasks({ ...base, segment: seg, tasks: [] });
    expect(plan.create.map((t) => t.title)).toContain("Find camp (Mia)");
    expect(plan.create.map((t) => t.title)).toContain("Ask grandparents (Leo)");
  });

  it("marks tasks of a replaced status as stale and is idempotent", () => {
    const existing = planSegmentTasks({ ...base, segment, tasks: [] }).create;
    const manual: Task = { id: "m", eventId: "e1", segmentId: "s1", title: "Mine", done: false, order: 9 };
    const again = planSegmentTasks({ ...base, segment, tasks: [...existing, manual] });
    expect(again.create).toEqual([]);
    expect(again.stale).toEqual([]);

    const seg = { ...segment, statuses: { a: "grandparents" as const, b: "grandparents" as const } };
    const plan = planSegmentTasks({ ...base, segment: seg, tasks: [...existing, manual] });
    expect(plan.stale.map((t) => t.title).sort()).toEqual(["Find camp", "Pack list", "Register & pay"]);
    expect(plan.create.map((t) => t.title)).toEqual(["Ask grandparents", "Confirm dates", "Arrange drop-off"]);
    expect(plan.create[0].order).toBeGreaterThan(9);
  });

  it("generates nothing for not relevant", () => {
    const seg = { ...segment, statuses: { a: "not_relevant" as const, b: "not_relevant" as const } };
    expect(planSegmentTasks({ ...base, segment: seg, tasks: [] }).create).toEqual([]);
  });
});

describe("coverage display labels", () => {
  const named = { ...segment, name: "Circus" };
  const eventWith = (seg: Segment) => ({ segments: [seg] });

  it("composes the action and the event context from the typed name", () => {
    expect(taskCoverageName(eventWith(named), { segmentId: "s1", status: "camp" })).toBe("Circus");
    expect(taskActionLabel("Pack", "Circus")).toBe("Pack for Circus");
    expect(taskActionLabel("pack", "Ibiza")).toBe("pack for Ibiza");
    expect(taskContextLabel("Holiday X", "Circus")).toBe("Holiday X - Circus");
    expect(taskExportSummary("Holiday X", "Register & pay", "Circus")).toBe(
      "Holiday X - Circus: Register & pay for Circus",
    );
  });

  it("falls back to the status label when the coverage was not named", () => {
    expect(taskCoverageName(eventWith(segment), { segmentId: "s1", status: "camp" })).toBe("Holiday camp");
    expect(taskCoverageName(eventWith(segment), { segmentId: "s1" })).toBe("Holiday camp");
    expect(taskActionLabel("Pack", "Holiday camp")).toBe("Pack for Holiday camp");
    expect(taskContextLabel("Holiday X", "Holiday camp")).toBe("Holiday X - Holiday camp");
    expect(taskActionLabel("Pack", "  ")).toBe("Pack");
  });

  it("keeps stored template titles free of the coverage name", () => {
    const tasks = generateTasks({ event, segment: named, status: "camp", templates, today: "2026-01-01" });
    expect(tasks.map((t) => t.title)).toEqual(["Find camp", "Register & pay", "Pack list"]);
  });
});

describe("taskGroup", () => {
  it("groups by due date", () => {
    expect(taskGroup({ due: "2026-01-01" }, "2026-01-05")).toBe("overdue");
    expect(taskGroup({ due: "2026-01-05" }, "2026-01-05")).toBe("week");
    expect(taskGroup({ due: "2026-01-12" }, "2026-01-05")).toBe("week");
    expect(taskGroup({ due: "2026-01-13" }, "2026-01-05")).toBe("later");
    expect(taskGroup({ due: null }, "2026-01-05")).toBe("nodate");
  });
});
