import type { NotificationPayload } from "../core/reminders";
import { PERIODIC_SYNC_TAG, runReminderCheck, type CheckResult } from "./reminderCheck";

export type PeriodicSyncState = "registered" | "unsupported" | "denied" | "error";

interface PeriodicSyncManager {
  register(tag: string, opts: { minInterval: number }): Promise<void>;
  getTags(): Promise<string[]>;
}

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsSupported()) return "unsupported";
  return Notification.requestPermission();
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((r) => setTimeout(() => r(null), 3000)),
    ]);
  } catch {
    return null;
  }
}

async function showNotification(n: NotificationPayload): Promise<void> {
  if (notificationPermission() !== "granted") return;
  const reg = await registration();
  const options: NotificationOptions = {
    body: n.body,
    tag: n.tag,
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    data: { route: n.route },
  };
  if (reg) await reg.showNotification(n.title, options);
  else new Notification(n.title, options);
}

/** Ask the browser to wake the service worker about daily (installed PWA, Chrome). */
export async function registerPeriodicSync(): Promise<PeriodicSyncState> {
  const reg = await registration();
  const ps = (reg as (ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager }) | null)?.periodicSync;
  if (!reg || !ps) return "unsupported";
  try {
    const status = await navigator.permissions.query({ name: "periodic-background-sync" as PermissionName });
    if (status.state !== "granted") return "denied";
    await ps.register(PERIODIC_SYNC_TAG, { minInterval: 12 * 60 * 60 * 1000 });
    return "registered";
  } catch (e) {
    console.warn("Periodic sync registration failed", e);
    return "error";
  }
}

export function checkRemindersNow(): Promise<CheckResult> {
  return runReminderCheck(showNotification);
}

export async function showTestNotification(): Promise<void> {
  await showNotification({
    tag: "mental-deload-test",
    title: "Mental Deload",
    body: "Notifications are working. You'll be reminded about undecided events and due tasks.",
    route: "/",
  });
}
