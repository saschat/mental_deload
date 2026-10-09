/**
 * Domain types. All dates are local calendar dates as "YYYY-MM-DD" strings
 * (end dates are inclusive), so everything stays timezone-agnostic and
 * serialises cleanly into Bazaar docs and IndexedDB.
 */

export type ISODate = string;

/**
 * Coverage status. `parent_off` is legacy: saved segments still display it,
 * but it is not offered in the picker or in new templates.
 */
export type StatusKey =
  | "childcare"
  | "grandparents"
  | "vacation"
  | "parent_off"
  | "camp"
  | "attending"
  | "guests"
  | "activity"
  | "not_relevant";

export type Category = "school" | "vacation" | "birthday" | "weekend" | "other";

/** "auto" lets the importer guess the category from the event title. */
export type SourceCategory = Category | "auto";

export interface Kid {
  id: string;
  name: string;
  color: string;
  /** Emoji or small data: URL image. */
  avatar?: string;
  order?: number;
}

export interface Source {
  id: string;
  name: string;
  /** "weekends" is generated in-app (Saturday–Sunday), not fetched from ICS. */
  type: "url" | "file" | "weekends";
  url?: string;
  defaultCategory: SourceCategory;
  kidIds: string[];
  lastImportedAt?: string;
  lastError?: string;
}

export interface Segment {
  id: string;
  start: ISODate;
  end: ISODate;
  /** Status per kid id. Missing kid = undecided for that kid. */
  statuses: Record<string, StatusKey>;
  /**
   * Optional name for this coverage block, shared by every kid on the segment
   * ("Circus", "Ibiza"). Blank means the status label is used for display.
   */
  name?: string;
}

export interface UpstreamSnapshot {
  title: string;
  start: ISODate;
  end: ISODate;
  startTime?: string;
  endTime?: string;
  description?: string;
  location?: string;
}

export type UpstreamFlag = "changed" | "removed";

export interface FamilyEvent extends UpstreamSnapshot {
  id: string;
  /** Null/undefined for manually created events. */
  sourceId?: string;
  /** ICS UID (+ RECURRENCE-ID) key; unique within a source. */
  externalKey?: string;
  category: Category;
  /** Kids for whom this event matters (default: all kids). */
  kidIds: string[];
  segments: Segment[];
  upstreamFlag?: UpstreamFlag | null;
  /** New upstream values waiting for the user to accept (flag "changed"). */
  upstreamPending?: UpstreamSnapshot | null;
  /** Upstream version the user chose to ignore ("keep mine"); not re-flagged. */
  upstreamIgnored?: UpstreamSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  eventId: string;
  segmentId?: string;
  /** Status whose template generated this task (for replacement). */
  status?: StatusKey;
  parentId?: string | null;
  title: string;
  due?: ISODate | null;
  done: boolean;
  order: number;
  generated?: boolean;
}

export interface TemplateNode {
  id: string;
  title: string;
  /** Days relative to the segment start (negative = before). */
  offsetDays?: number | null;
  children: TemplateNode[];
}

export interface TaskTemplate {
  id: string;
  status: StatusKey;
  /** Template only applies to this category; null = any category. */
  category: Category | null;
  nodes: TemplateNode[];
}

export interface ReminderTierConfig {
  /** Days before start, e.g. [180, 90, 30]. */
  tiers: number[];
  /** After the smallest tier, remind every N days until start (0 = off). */
  repeatEveryDays: number;
}

export interface StatusDef {
  key: StatusKey;
  label: string;
  color: string;
}

export interface Settings {
  id: string;
  statusColors: Partial<Record<StatusKey, string>>;
  templates: TaskTemplate[];
  reminderTiers: Record<Category, ReminderTierConfig>;
  /** Remind about tasks due within this many days. */
  taskDueSoonDays: number;
  corsProxy: string;
}
