/**
 * Shared reminder check used by the page (on open / visibility change) and by
 * the service worker (Periodic Background Sync). Reads the cached snapshot,
 * computes due reminders with the pure core, and records sent keys.
 */
import { today as todayOf } from "../core/dates";
import { normalizeSettings } from "../core/defaults";
import { dueReminders, pruneSent, toNotifications, type NotificationPayload, type Reminder } from "../core/reminders";
import { idbGet, idbSet, LAST_CHECK_KEY, SENT_KEY, SNAPSHOT_KEY, type Snapshot } from "./idb";

export const PERIODIC_SYNC_TAG = "mental-deload-reminders";

export interface CheckResult {
  reminders: Reminder[];
  notifications: NotificationPayload[];
}

export async function runReminderCheck(
  show: (n: NotificationPayload) => Promise<void>,
  now: Date = new Date(),
): Promise<CheckResult> {
  const snap = await idbGet<Snapshot>(SNAPSHOT_KEY);
  if (!snap) return { reminders: [], notifications: [] };
  const input = {
    events: snap.events,
    tasks: snap.tasks,
    kids: snap.kids,
    settings: normalizeSettings(snap.settings),
    today: todayOf(now),
  };
  const sent = new Set((await idbGet<string[]>(SENT_KEY)) ?? []);
  const due = dueReminders(input, sent);
  const notifications = toNotifications(due);
  for (const n of notifications) {
    try {
      await show(n);
    } catch (e) {
      console.warn("Could not show notification", e);
    }
  }
  for (const r of due) sent.add(r.key);
  await idbSet(SENT_KEY, pruneSent(sent, input));
  await idbSet(LAST_CHECK_KEY, now.toISOString());
  return { reminders: due, notifications };
}
