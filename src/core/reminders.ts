/**
 * Pure reminder computation. Takes a snapshot of events/tasks/settings plus
 * the set of already-sent reminder keys and returns what is due now. It has no
 * browser dependencies so it can run in the page, the service worker, or later
 * server-side inside Bazaar.
 */
import { addDays, diffDays, formatRange, relativeDays } from "./dates";
import { isUndecided } from "./coverage";
import { taskActionLabel, taskContextLabel, taskCoverageName } from "./tasks";
import type { FamilyEvent, ISODate, Kid, ReminderTierConfig, Settings, Task } from "./types";

export type ReminderKind = "event" | "task-overdue" | "task-soon";

export interface Reminder {
  /** Stable dedupe key; once sent it must not be sent again. */
  key: string;
  kind: ReminderKind;
  eventId: string;
  taskId?: string;
  title: string;
  body: string;
  /** Days until the event start / task due date (negative = overdue). */
  daysUntil: number;
}

export interface ReminderInput {
  events: FamilyEvent[];
  tasks: Task[];
  kids: Pick<Kid, "id">[];
  settings: Pick<Settings, "reminderTiers" | "taskDueSoonDays">;
  today: ISODate;
}

function sortedTiers(cfg: ReminderTierConfig): number[] {
  return [...new Set(cfg.tiers.filter((t) => t >= 0))].sort((a, b) => b - a);
}

/**
 * Which tier is active for an event `daysUntil` days away, or null when no
 * tier has been reached yet. Only the most recently crossed tier is returned,
 * so opening the app after a long pause doesn't replay every older tier.
 */
export function activeTier(daysUntil: number, cfg: ReminderTierConfig): string | null {
  const tiers = sortedTiers(cfg);
  if (!tiers.length || daysUntil < 0) return null;
  const smallest = tiers[tiers.length - 1];
  if (daysUntil <= smallest && cfg.repeatEveryDays > 0) {
    const bucket = Math.floor((smallest - daysUntil) / cfg.repeatEveryDays);
    if (bucket >= 1) return `r${bucket}`;
  }
  const crossed = tiers.filter((t) => daysUntil <= t);
  if (!crossed.length) return null;
  return `t${crossed[crossed.length - 1]}`;
}

/** All future dates on which an event reminder would fire (for display/export). */
export function reminderSchedule(start: ISODate, cfg: ReminderTierConfig, today: ISODate): ISODate[] {
  const tiers = sortedTiers(cfg);
  const dates = new Set<ISODate>(tiers.map((t) => addDays(start, -t)));
  const smallest = tiers[tiers.length - 1];
  if (smallest !== undefined && cfg.repeatEveryDays > 0) {
    for (let d = smallest - cfg.repeatEveryDays; d >= 0; d -= cfg.repeatEveryDays) {
      dates.add(addDays(start, -d));
    }
  }
  return [...dates].filter((d) => d >= today).sort();
}

export function eventReminderKey(event: Pick<FamilyEvent, "id" | "start">, tier: string): string {
  return `ev:${event.id}:${event.start}:${tier}`;
}

/** Every reminder that is currently active (ignores what was already sent). */
export function activeReminders(input: ReminderInput): Reminder[] {
  const out: Reminder[] = [];
  const eventsById = new Map(input.events.map((e) => [e.id, e]));

  for (const ev of input.events) {
    const d = diffDays(input.today, ev.start);
    if (d < 0 || !isUndecided(ev, input.kids)) continue;
    const cfg = input.settings.reminderTiers[ev.category] ?? input.settings.reminderTiers.other;
    if (!cfg) continue;
    const tier = activeTier(d, cfg);
    if (!tier) continue;
    out.push({
      key: eventReminderKey(ev, tier),
      kind: "event",
      eventId: ev.id,
      title: `Decide: ${ev.title}`,
      body: `${formatRange(ev.start, ev.end)} (${relativeDays(ev.start, input.today)}) still needs a plan.`,
      daysUntil: d,
    });
  }

  for (const t of input.tasks) {
    if (t.done || !t.due) continue;
    const ev = eventsById.get(t.eventId);
    if (!ev) continue;
    const coverage = taskCoverageName(ev, t);
    const action = taskActionLabel(t.title, coverage);
    const context = taskContextLabel(ev.title, coverage);
    const d = diffDays(input.today, t.due);
    if (d < 0) {
      out.push({
        key: `task:${t.id}:overdue:${t.due}`,
        kind: "task-overdue",
        eventId: ev.id,
        taskId: t.id,
        title: `Overdue: ${action}`,
        body: `For "${context}", was due ${relativeDays(t.due, input.today)}.`,
        daysUntil: d,
      });
    } else if (d <= input.settings.taskDueSoonDays) {
      out.push({
        key: `task:${t.id}:soon:${t.due}`,
        kind: "task-soon",
        eventId: ev.id,
        taskId: t.id,
        title: `Due ${relativeDays(t.due, input.today)}: ${action}`,
        body: `For "${context}".`,
        daysUntil: d,
      });
    }
  }

  return out.sort((a, b) => a.daysUntil - b.daysUntil);
}

/** Reminders that are active and have not been sent yet. */
export function dueReminders(input: ReminderInput, sent: ReadonlySet<string>): Reminder[] {
  return activeReminders(input).filter((r) => !sent.has(r.key));
}

export interface NotificationPayload {
  tag: string;
  title: string;
  body: string;
  /** In-app route to open on click, e.g. "/event/abc". */
  route: string;
}

/** Group reminders into a small number of notifications. */
export function toNotifications(reminders: Reminder[], maxIndividual = 3): NotificationPayload[] {
  if (reminders.length <= maxIndividual) {
    return reminders.map((r) => ({
      tag: r.key,
      title: r.title,
      body: r.body,
      route: `/event/${r.eventId}`,
    }));
  }
  const events = reminders.filter((r) => r.kind === "event").length;
  const tasks = reminders.length - events;
  const parts = [];
  if (events) parts.push(`${events} event${events === 1 ? "" : "s"} need a decision`);
  if (tasks) parts.push(`${tasks} task${tasks === 1 ? "" : "s"} due`);
  return [
    {
      tag: "mental-deload-summary",
      title: "Mental Deload",
      body: `${parts.join(", ")}. Next: ${reminders[0].title}`,
      route: events ? "/" : "/tasks",
    },
  ];
}

/** Drop sent keys that can never become active again (keeps storage small). */
export function pruneSent(sent: Iterable<string>, input: ReminderInput): string[] {
  const eventIds = new Set(input.events.map((e) => e.id));
  const taskIds = new Set(input.tasks.filter((t) => !t.done).map((t) => t.id));
  return [...sent].filter((key) => {
    const [kind, id] = key.split(":");
    return kind === "ev" ? eventIds.has(id) : taskIds.has(id);
  });
}
