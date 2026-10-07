import { clipSegments, hasAnyStatus } from "./coverage";
import { newId } from "./defaults";
import type { ParsedItem } from "./icsParse";
import type { FamilyEvent, ISODate, Source, Task, UpstreamSnapshot } from "./types";

const SNAPSHOT_FIELDS = ["title", "start", "end", "startTime", "endTime", "description", "location"] as const;

export function snapshotOf(x: UpstreamSnapshot): UpstreamSnapshot {
  const out: UpstreamSnapshot = { title: x.title, start: x.start, end: x.end };
  for (const f of SNAPSHOT_FIELDS) {
    const v = x[f];
    if (v !== undefined && v !== null && v !== "") (out as unknown as Record<string, string>)[f] = v;
  }
  return out;
}

export function sameSnapshot(a: UpstreamSnapshot | null | undefined, b: UpstreamSnapshot | null | undefined): boolean {
  if (!a || !b) return false;
  return SNAPSHOT_FIELDS.every((f) => (a[f] || undefined) === (b[f] || undefined));
}

export interface ImportPlan {
  create: FamilyEvent[];
  /** Silent updates for events without decisions, or clearing stale flags. */
  update: { id: string; patch: Partial<FamilyEvent> }[];
  /** Decided events whose upstream data changed: flag + store pending values. */
  flagChanged: { id: string; pending: UpstreamSnapshot }[];
  /** Decided events that disappeared upstream. */
  flagRemoved: string[];
  /** Undecided events that disappeared upstream. */
  remove: string[];
  unchanged: number;
}

export interface ImportSummary {
  created: number;
  updated: number;
  flagged: number;
  removed: number;
  unchanged: number;
}

export function summarize(plan: ImportPlan): ImportSummary {
  return {
    created: plan.create.length,
    updated: plan.update.length,
    flagged: plan.flagChanged.length + plan.flagRemoved.length,
    removed: plan.remove.length,
    unchanged: plan.unchanged,
  };
}

/** The user has put work into an event: statuses or tasks exist. */
export function isInvested(event: FamilyEvent, tasks: Task[]): boolean {
  return hasAnyStatus(event) || tasks.some((t) => t.eventId === event.id);
}

/**
 * Compute an idempotent import plan for one source. Events are matched by
 * source id + external key (ICS UID + RECURRENCE-ID). Events the user already
 * decided on are never silently changed or deleted; they get flagged instead.
 */
export function planImport(args: {
  source: Pick<Source, "id" | "kidIds">;
  existing: FamilyEvent[];
  parsed: ParsedItem[];
  tasks: Task[];
  /** Events ending before this date are left alone (feeds often prune the past). */
  from: ISODate;
  /** Events starting after this date are left alone (outside the horizon). */
  until: ISODate;
  now: string;
}): ImportPlan {
  const plan: ImportPlan = { create: [], update: [], flagChanged: [], flagRemoved: [], remove: [], unchanged: 0 };
  const mine = args.existing.filter((e) => e.sourceId === args.source.id && e.externalKey);
  const byKey = new Map(mine.map((e) => [e.externalKey!, e]));
  const seen = new Set<string>();

  for (const item of args.parsed) {
    if (seen.has(item.externalKey)) continue;
    seen.add(item.externalKey);
    const snap = snapshotOf(item);
    const ev = byKey.get(item.externalKey);

    if (!ev) {
      plan.create.push({
        ...snap,
        id: newId(),
        sourceId: args.source.id,
        externalKey: item.externalKey,
        category: item.category,
        kidIds: [...args.source.kidIds],
        segments: [],
        upstreamFlag: null,
        upstreamPending: null,
        upstreamIgnored: null,
        createdAt: args.now,
        updatedAt: args.now,
      });
      continue;
    }

    if (sameSnapshot(snapshotOf(ev), snap)) {
      if (ev.upstreamFlag || ev.upstreamPending) {
        plan.update.push({ id: ev.id, patch: { upstreamFlag: null, upstreamPending: null } });
      } else {
        plan.unchanged++;
      }
      continue;
    }

    if (!isInvested(ev, args.tasks)) {
      plan.update.push({
        id: ev.id,
        patch: { ...emptySnapshotPatch(), ...snap, upstreamFlag: null, upstreamPending: null, updatedAt: args.now },
      });
      continue;
    }

    const alreadyKnown =
      (ev.upstreamFlag === "changed" && sameSnapshot(ev.upstreamPending, snap)) || sameSnapshot(ev.upstreamIgnored, snap);
    if (alreadyKnown) plan.unchanged++;
    else plan.flagChanged.push({ id: ev.id, pending: snap });
  }

  for (const ev of mine) {
    if (seen.has(ev.externalKey!)) continue;
    if (ev.end < args.from || ev.start > args.until) continue;
    if (!isInvested(ev, args.tasks)) plan.remove.push(ev.id);
    else if (ev.upstreamFlag === "removed") plan.unchanged++;
    else plan.flagRemoved.push(ev.id);
  }

  return plan;
}

/** Clears optional snapshot fields so removed upstream values don't linger. */
function emptySnapshotPatch(): Partial<UpstreamSnapshot> {
  return { startTime: undefined, endTime: undefined, description: undefined, location: undefined };
}

/** Accept a pending upstream change: apply new values, clip segments to the new dates. */
export function acceptUpstream(ev: FamilyEvent, now: string): FamilyEvent {
  if (!ev.upstreamPending) return { ...ev, upstreamFlag: null };
  const p = ev.upstreamPending;
  const next: FamilyEvent = {
    ...ev,
    startTime: undefined,
    endTime: undefined,
    description: undefined,
    location: undefined,
    ...p,
    segments: clipSegments(ev.segments ?? [], p.start, p.end),
    upstreamFlag: null,
    upstreamPending: null,
    upstreamIgnored: null,
    updatedAt: now,
  };
  return stripUndefined(next);
}

/** Keep the local version; remember the upstream version so it isn't re-flagged. */
export function ignoreUpstream(ev: FamilyEvent, now: string): FamilyEvent {
  if (ev.upstreamFlag === "removed") {
    // Detach from the source: it becomes a manual event.
    return stripUndefined({ ...ev, sourceId: undefined, externalKey: undefined, upstreamFlag: null, upstreamPending: null, updatedAt: now });
  }
  return { ...ev, upstreamIgnored: ev.upstreamPending ?? null, upstreamFlag: null, upstreamPending: null, updatedAt: now };
}

export function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
