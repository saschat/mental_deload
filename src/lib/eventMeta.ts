import { diffDays } from "@/core/dates";
import type { FamilyEvent, ISODate } from "@/core/types";

export type Urgency = "red" | "orange" | "yellow" | "none";

/** Inbox urgency: red < 1 month, orange < 3 months, yellow < 6 months. */
export function urgency(ev: Pick<FamilyEvent, "start">, today: ISODate): Urgency {
  const d = diffDays(today, ev.start);
  if (d < 31) return "red";
  if (d < 92) return "orange";
  if (d < 183) return "yellow";
  return "none";
}

export const URGENCY_COLORS: Record<Urgency, string> = {
  red: "#e53935",
  orange: "#fb8c00",
  yellow: "#fdd835",
  none: "#c7cbe0",
};

export function timeLabel(ev: Pick<FamilyEvent, "startTime" | "endTime">): string {
  if (!ev.startTime) return "";
  return ev.endTime ? `${ev.startTime}–${ev.endTime}` : ev.startTime;
}
