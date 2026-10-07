import { addDays, diffDays, maxDate } from "./dates";
import { newId } from "./defaults";
import type {
  Category,
  FamilyEvent,
  ISODate,
  Kid,
  Segment,
  StatusKey,
  Task,
  TaskTemplate,
  TemplateNode,
} from "./types";

/** Prefer a category-specific template, fall back to the generic one. */
export function pickTemplate(
  templates: TaskTemplate[],
  status: StatusKey,
  category: Category,
): TaskTemplate | undefined {
  return (
    templates.find((t) => t.status === status && t.category === category) ??
    templates.find((t) => t.status === status && !t.category)
  );
}

/** Distinct statuses in a segment that may generate tasks, with their kids. */
export function segmentStatusGroups(
  segment: Segment,
  kidIds: string[],
): { status: StatusKey; kidIds: string[] }[] {
  const groups = new Map<StatusKey, string[]>();
  for (const id of kidIds) {
    const st = segment.statuses?.[id];
    if (!st || st === "not_relevant") continue;
    groups.set(st, [...(groups.get(st) ?? []), id]);
  }
  return [...groups.entries()].map(([status, ids]) => ({ status, kidIds: ids }));
}

export interface GenerateOptions {
  event: Pick<FamilyEvent, "id" | "category">;
  segment: Segment;
  status: StatusKey;
  templates: TaskTemplate[];
  today: ISODate;
  /** Appended to root task titles, e.g. " (Mia)" when kids differ. */
  suffix?: string;
  startOrder?: number;
}

/**
 * Generate a task tree for one status of a segment. Due dates are relative to
 * the segment start; dates already in the past are clamped to today.
 */
export function generateTasks(opts: GenerateOptions): Task[] {
  const tpl = pickTemplate(opts.templates, opts.status, opts.event.category);
  if (!tpl) return [];
  const out: Task[] = [];
  let order = opts.startOrder ?? 0;

  const walk = (nodes: TemplateNode[], parentId: string | null) => {
    for (const n of nodes) {
      const id = newId();
      const due =
        n.offsetDays === null || n.offsetDays === undefined
          ? null
          : maxDate(addDays(opts.segment.start, n.offsetDays), opts.today);
      out.push({
        id,
        eventId: opts.event.id,
        segmentId: opts.segment.id,
        status: opts.status,
        parentId,
        title: parentId === null && opts.suffix ? `${n.title}${opts.suffix}` : n.title,
        due,
        done: false,
        order: order++,
        generated: true,
      });
      walk(n.children ?? [], id);
    }
  };
  walk(tpl.nodes, null);
  return out;
}

export interface SegmentTaskPlan {
  /** Generated tasks whose status no longer applies to the segment. */
  stale: Task[];
  /** New tasks for statuses that don't have generated tasks yet. */
  create: Task[];
}

/**
 * Work out which generated tasks a status change makes obsolete and which new
 * ones should be created. The UI asks before deleting `stale`.
 */
export function planSegmentTasks(args: {
  event: Pick<FamilyEvent, "id" | "category">;
  segment: Segment;
  kids: Pick<Kid, "id" | "name">[];
  kidIds: string[];
  tasks: Task[];
  templates: TaskTemplate[];
  today: ISODate;
}): SegmentTaskPlan {
  const groups = segmentStatusGroups(args.segment, args.kidIds);
  const statuses = new Set(groups.map((g) => g.status));
  const segTasks = args.tasks.filter((t) => t.eventId === args.event.id && t.segmentId === args.segment.id);
  const generated = segTasks.filter((t) => t.generated);
  const staleRoots = generated.filter((t) => t.status && !statuses.has(t.status));
  const stale = withDescendants(staleRoots, args.tasks);
  const existingStatuses = new Set(generated.map((t) => t.status));
  const split = groups.length > 1;
  let order = Math.max(-1, ...segTasks.map((t) => t.order)) + 1;
  const create: Task[] = [];
  for (const g of groups) {
    if (existingStatuses.has(g.status)) continue;
    const names = g.kidIds
      .map((id) => args.kids.find((k) => k.id === id)?.name)
      .filter(Boolean)
      .join(", ");
    const tasks = generateTasks({
      event: args.event,
      segment: args.segment,
      status: g.status,
      templates: args.templates,
      today: args.today,
      suffix: split && names ? ` (${names})` : undefined,
      startOrder: order,
    });
    order += tasks.length;
    create.push(...tasks);
  }
  return { stale, create };
}

/** The given tasks plus all their descendants (deduplicated). */
export function withDescendants(roots: Task[], all: Task[]): Task[] {
  const ids = new Set(roots.map((t) => t.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of all) {
      if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) {
        ids.add(t.id);
        grew = true;
      }
    }
  }
  return all.filter((t) => ids.has(t.id));
}

export interface TaskNode {
  task: Task;
  children: TaskNode[];
  depth: number;
}

function compareTasks(a: Task, b: Task): number {
  if (a.order !== b.order) return a.order - b.order;
  return (a.due ?? "9999") < (b.due ?? "9999") ? -1 : 1;
}

/** Build a tree from a flat task list; orphans become roots. */
export function buildTaskTree(tasks: Task[]): TaskNode[] {
  const ids = new Set(tasks.map((t) => t.id));
  const byParent = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const key = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), t]);
  }
  const build = (parent: string | null, depth: number): TaskNode[] =>
    (byParent.get(parent) ?? [])
      .sort(compareTasks)
      .map((task) => ({ task, depth, children: build(task.id, depth + 1) }));
  return build(null, 0);
}

export function flattenTree(nodes: TaskNode[]): TaskNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

export function taskProgress(tasks: Task[]): { done: number; total: number } {
  return { done: tasks.filter((t) => t.done).length, total: tasks.length };
}

export type TaskGroup = "overdue" | "week" | "later" | "nodate";

export function taskGroup(task: Pick<Task, "due">, today: ISODate): TaskGroup {
  if (!task.due) return "nodate";
  const d = diffDays(today, task.due);
  if (d < 0) return "overdue";
  if (d <= 7) return "week";
  return "later";
}
