import { addDays, diffDays } from "./dates";
import { isUndecided } from "./coverage";
import { taskContextLabel, taskCoverageName, taskExportSummary } from "./tasks";
import type { FamilyEvent, ISODate, Kid, Settings, Task } from "./types";

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/** Fold lines to 75 octets as required by RFC 5545 (approximated by chars). */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(" " + line.slice(i, i + 74));
  return parts.join("\r\n");
}

function icsDate(d: ISODate): string {
  return d.replace(/-/g, "");
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
}

function alarm(trigger: string, description: string): string[] {
  return ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(description)}`, `TRIGGER:${trigger}`, "END:VALARM"];
}

/** Trigger relative to the (all-day) event start at local midnight, at 9:00. */
function triggerDaysBefore(days: number): string {
  // e.g. 30 days before at 09:00 = -P29DT15H
  if (days <= 0) return "PT9H";
  return `-P${days - 1}DT15H`;
}

export interface ExportOptions {
  events: FamilyEvent[];
  tasks: Task[];
  kids: Pick<Kid, "id">[];
  settings: Pick<Settings, "reminderTiers">;
  today: ISODate;
  now?: Date;
  /** Calendars like Google honour only a few alarms per event. */
  maxAlarmsPerEvent?: number;
}

/**
 * Build an .ics file with one all-day VEVENT per undecided upcoming event and
 * per open task with a due date, each with VALARMs matching the reminder tiers.
 * Re-importing replaces previous exports thanks to stable UIDs.
 */
export function buildRemindersIcs(opts: ExportOptions): string {
  const now = opts.now ?? new Date();
  const maxAlarms = opts.maxAlarmsPerEvent ?? 5;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mental Deload//Reminders//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Mental Deload reminders",
  ];
  const eventsById = new Map(opts.events.map((e) => [e.id, e]));

  for (const ev of opts.events) {
    if (ev.start < opts.today || !isUndecided(ev, opts.kids)) continue;
    const cfg = opts.settings.reminderTiers[ev.category] ?? opts.settings.reminderTiers.other;
    const until = diffDays(opts.today, ev.start);
    const offsets = new Set(cfg.tiers.filter((t) => t >= 0 && t <= until));
    const smallest = Math.min(...cfg.tiers);
    if (cfg.repeatEveryDays > 0 && Number.isFinite(smallest)) {
      for (let d = smallest - cfg.repeatEveryDays; d > 0; d -= cfg.repeatEveryDays) {
        if (d <= until) offsets.add(d);
      }
    }
    // Keep the alarms closest to the event when a calendar limits the count.
    const chosen = [...offsets].sort((a, b) => a - b).slice(0, maxAlarms);
    lines.push(
      "BEGIN:VEVENT",
      `UID:md-event-${ev.id}@mental-deload`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${icsDate(ev.start)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(ev.end, 1))}`,
      `SUMMARY:${escapeText(`Decide: ${ev.title}`)}`,
      `DESCRIPTION:${escapeText("Still undecided in Mental Deload. Open the app to set a status.")}`,
      "TRANSP:TRANSPARENT",
    );
    for (const d of chosen) lines.push(...alarm(triggerDaysBefore(d), `Decide: ${ev.title}`));
    lines.push("END:VEVENT");
  }

  for (const t of opts.tasks) {
    if (t.done || !t.due || t.due < opts.today) continue;
    const ev = eventsById.get(t.eventId);
    if (!ev) continue;
    const coverage = taskCoverageName(ev, t);
    const summary = taskExportSummary(ev.title, t.title, coverage);
    const context = taskContextLabel(ev.title, coverage);
    lines.push(
      "BEGIN:VEVENT",
      `UID:md-task-${t.id}@mental-deload`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${icsDate(t.due)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(t.due, 1))}`,
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(coverage ? context : `For "${ev.title}"`)}`,
      "TRANSP:TRANSPARENT",
      ...alarm("PT9H", summary),
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
