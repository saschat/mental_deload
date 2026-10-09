import type { ISODate } from "./types";

/** How far ahead ICS recurrences and generated weekends are expanded. */
export const HORIZON_MONTHS = 18;

const DAY_MS = 86_400_000;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse "YYYY-MM-DD" to a UTC-midnight timestamp (for day arithmetic only). */
function utc(date: ISODate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): ISODate {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function today(now: Date = new Date()): ISODate {
  return toISODate(now);
}

/** 0 = Sunday … 6 = Saturday. Uses the same UTC-midnight arithmetic as addDays. */
export function weekday(date: ISODate): number {
  return new Date(utc(date)).getUTCDay();
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromUtc(utc(date) + days * DAY_MS);
}

export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return fromUtc(target.getTime());
}

/** Whole days from a to b (b - a). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

/** Number of days in an inclusive range. */
export function rangeLength(start: ISODate, end: ISODate): number {
  return diffDays(start, end) + 1;
}

/** Parse a local date string into a Date at local midnight. */
export function parseLocal(date: ISODate): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(
  date: ISODate,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
): string {
  return parseLocal(date).toLocaleDateString("en-GB", opts);
}

export function formatRange(start: ISODate, end: ISODate): string {
  if (start === end) {
    return formatDate(start, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  }
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const a = formatDate(start, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  const b = formatDate(end, { day: "numeric", month: "short", year: "numeric" });
  return `${a} – ${b}`;
}

export function relativeDays(date: ISODate, ref: ISODate): string {
  const d = diffDays(ref, date);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  if (d < 0) return `${-d} days ago`;
  if (d < 14) return `in ${d} days`;
  if (d < 60) return `in ${Math.round(d / 7)} weeks`;
  return `in ${Math.round(d / 30.4)} months`;
}
