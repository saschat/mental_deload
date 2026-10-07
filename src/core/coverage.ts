import { addDays, diffDays, formatDate, maxDate, minDate, rangeLength } from "./dates";
import { newId } from "./defaults";
import type { FamilyEvent, ISODate, Kid, Segment, StatusKey } from "./types";

/** Kids the event is relevant for. An empty list means "all kids". */
export function relevantKidIds(event: Pick<FamilyEvent, "kidIds">, kids: Pick<Kid, "id">[]): string[] {
  const all = kids.map((k) => k.id);
  if (!event.kidIds || event.kidIds.length === 0) return all;
  const known = new Set(all);
  const ids = event.kidIds.filter((id) => known.has(id));
  return ids.length ? ids : all;
}

export interface DayRange {
  start: ISODate;
  end: ISODate;
}

/** Day ranges within the event not covered by any segment status for this kid. */
export function uncoveredRanges(
  event: Pick<FamilyEvent, "start" | "end" | "segments">,
  kidId: string,
): DayRange[] {
  const covered = (event.segments ?? [])
    .filter((s) => s.statuses?.[kidId])
    .map((s) => ({ start: maxDate(s.start, event.start), end: minDate(s.end, event.end) }))
    .filter((r) => r.start <= r.end)
    .sort((a, b) => (a.start < b.start ? -1 : 1));

  const gaps: DayRange[] = [];
  let cursor = event.start;
  for (const r of covered) {
    if (r.start > cursor) gaps.push({ start: cursor, end: addDays(r.start, -1) });
    if (r.end >= cursor) cursor = addDays(r.end, 1);
  }
  if (cursor <= event.end) gaps.push({ start: cursor, end: event.end });
  return gaps;
}

export function isKidDecided(event: Pick<FamilyEvent, "start" | "end" | "segments">, kidId: string): boolean {
  return uncoveredRanges(event, kidId).length === 0;
}

/** An event is undecided until every day is covered for every relevant kid. */
export function isUndecided(
  event: Pick<FamilyEvent, "start" | "end" | "segments" | "kidIds">,
  kids: Pick<Kid, "id">[],
): boolean {
  const ids = relevantKidIds(event, kids);
  if (ids.length === 0) return (event.segments ?? []).length === 0;
  return ids.some((id) => !isKidDecided(event, id));
}

/** Share of (kid × day) cells that are covered, 0..1. */
export function coverageFraction(
  event: Pick<FamilyEvent, "start" | "end" | "segments" | "kidIds">,
  kids: Pick<Kid, "id">[],
): number {
  const ids = relevantKidIds(event, kids);
  const days = rangeLength(event.start, event.end);
  if (!ids.length || days <= 0) return 0;
  let missing = 0;
  for (const id of ids) {
    for (const g of uncoveredRanges(event, id)) missing += rangeLength(g.start, g.end);
  }
  return 1 - missing / (days * ids.length);
}

export function hasAnyStatus(event: Pick<FamilyEvent, "segments">): boolean {
  return (event.segments ?? []).some((s) => Object.keys(s.statuses ?? {}).length > 0);
}

export function fullSegment(event: Pick<FamilyEvent, "start" | "end">, statuses: Record<string, StatusKey> = {}): Segment {
  return { id: newId(), start: event.start, end: event.end, statuses };
}

/** Segments sorted by start; creates a single whole-event segment if none exist. */
export function ensureSegments(event: Pick<FamilyEvent, "start" | "end" | "segments">): Segment[] {
  const segs = [...(event.segments ?? [])].sort((a, b) => (a.start < b.start ? -1 : 1));
  return segs.length ? segs : [fullSegment(event)];
}

/** Set the same status for all given kids on every segment (one-tap decision). */
export function setStatusForAll(
  event: Pick<FamilyEvent, "start" | "end" | "segments">,
  kidIds: string[],
  status: StatusKey,
): Segment[] {
  const segs = event.segments?.length === 1 ? event.segments : [fullSegment(event)];
  return segs.map((s) => ({
    ...s,
    start: event.start,
    end: event.end,
    statuses: Object.fromEntries(kidIds.map((id) => [id, status])),
  }));
}

export function setSegmentStatus(
  segments: Segment[],
  segmentId: string,
  kidIds: string[],
  status: StatusKey | null,
): Segment[] {
  return segments.map((s) => {
    if (s.id !== segmentId) return s;
    const statuses = { ...s.statuses };
    for (const id of kidIds) {
      if (status) statuses[id] = status;
      else delete statuses[id];
    }
    return { ...s, statuses };
  });
}

/**
 * Split a segment so that `splitDate` starts a new segment. The new segment
 * copies the statuses of the original. Returns the input unchanged when the
 * date is not strictly inside the segment.
 */
export function splitSegment(segments: Segment[], segmentId: string, splitDate: ISODate): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    if (s.id === segmentId && splitDate > s.start && splitDate <= s.end) {
      out.push({ ...s, end: addDays(splitDate, -1) });
      out.push({ id: newId(), start: splitDate, end: s.end, statuses: { ...s.statuses } });
    } else {
      out.push(s);
    }
  }
  return out;
}

/** Remove a segment, extending the previous (or next) neighbour over its days. */
export function removeSegment(segments: Segment[], segmentId: string): Segment[] {
  const sorted = [...segments].sort((a, b) => (a.start < b.start ? -1 : 1));
  const idx = sorted.findIndex((s) => s.id === segmentId);
  if (idx < 0 || sorted.length < 2) return segments;
  const removed = sorted[idx];
  if (idx > 0) {
    sorted[idx - 1] = { ...sorted[idx - 1], end: maxDate(sorted[idx - 1].end, removed.end) };
  } else {
    sorted[1] = { ...sorted[1], start: minDate(sorted[1].start, removed.start) };
  }
  sorted.splice(idx, 1);
  return sorted;
}

/** Clip segments to a new event range (after an accepted upstream date change). */
export function clipSegments(segments: Segment[], start: ISODate, end: ISODate): Segment[] {
  return segments
    .map((s) => ({ ...s, start: maxDate(s.start, start), end: minDate(s.end, end) }))
    .filter((s) => s.start <= s.end);
}

/** Clip segments to a (new) date range and fill any gaps with empty segments, so every day stays editable. */
export function fitSegments(segments: Segment[], start: ISODate, end: ISODate): Segment[] {
  const clipped = clipSegments(segments, start, end).sort((a, b) => (a.start < b.start ? -1 : 1));
  if (!clipped.length) return [];
  const out: Segment[] = [];
  let cursor = start;
  for (const s of clipped) {
    if (s.start > cursor) out.push({ id: newId(), start: cursor, end: addDays(s.start, -1), statuses: {} });
    out.push(s);
    if (s.end >= cursor) cursor = addDays(s.end, 1);
  }
  if (cursor <= end) out.push({ id: newId(), start: cursor, end, statuses: {} });
  return out;
}

/** Whether every segment has the same status for all given kids. */
export function isUniform(segments: Segment[], kidIds: string[]): boolean {
  return segments.every((s) => {
    const values = kidIds.map((id) => s.statuses?.[id] ?? null);
    return values.every((v) => v === values[0]);
  });
}

export interface SegmentLabel {
  label: string;
  status: StatusKey | null;
}

/**
 * Per-kid summary for agenda pills, e.g. [{"Wk1", grandparents}, {"Wk2", camp}].
 * A single segment yields a single entry with an empty label.
 */
export function kidSegmentSummary(
  event: Pick<FamilyEvent, "start" | "end" | "segments">,
  kidId: string,
): SegmentLabel[] {
  const segs = [...(event.segments ?? [])].sort((a, b) => (a.start < b.start ? -1 : 1));
  if (segs.length <= 1) {
    const status = segs[0]?.statuses?.[kidId] ?? null;
    const partial = segs.length === 1 && status !== null && !isKidDecided(event, kidId);
    return [{ label: partial ? "partly" : "", status }];
  }
  const weekLabels = segs.map((s) => `Wk${Math.floor(diffDays(event.start, s.start) / 7) + 1}`);
  const uniqueWeeks = new Set(weekLabels).size === weekLabels.length;
  return segs.map((s, i) => ({
    label: uniqueWeeks ? weekLabels[i] : formatDate(s.start),
    status: s.statuses?.[kidId] ?? null,
  }));
}
