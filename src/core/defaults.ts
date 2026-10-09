import type {
  Category,
  ReminderTierConfig,
  Settings,
  StatusDef,
  StatusKey,
  TaskTemplate,
  TemplateNode,
} from "./types";

/** Statuses offered in the picker and for new templates. */
export const STATUSES: StatusDef[] = [
  { key: "childcare", label: "Child care", color: "#3b82f6" },
  { key: "grandparents", label: "Grandparents", color: "#8b5cf6" },
  { key: "vacation", label: "Family vacation", color: "#10b981" },
  { key: "camp", label: "Holiday camp", color: "#f59e0b" },
  { key: "attending", label: "Attending", color: "#ec4899" },
  { key: "guests", label: "Guests", color: "#6366f1" },
  { key: "activity", label: "Activity", color: "#0891b2" },
  { key: "not_relevant", label: "Not relevant", color: "#9ca3af" },
];

/** Saved on older segments. Display only — not in the picker. */
const LEGACY_STATUSES: StatusDef[] = [{ key: "parent_off", label: "Parent off", color: "#14b8a6" }];

const STATUS_DEFS = [...STATUSES, ...LEGACY_STATUSES];

const statusLabels: Record<string, string> = Object.fromEntries(STATUS_DEFS.map((s) => [s.key, s.label]));
/** Older docs may have stored the camelCase spelling. */
statusLabels.parentOff = statusLabels.parent_off;

export const STATUS_LABELS = statusLabels as Record<StatusKey, string>;

export function statusLabel(key: StatusKey | string | null | undefined): string {
  if (!key) return "";
  return statusLabels[key] ?? "";
}

export const CATEGORIES: { key: Category; label: string }[] = [
  { key: "school", label: "School" },
  { key: "vacation", label: "Vacation / holiday" },
  { key: "birthday", label: "Birthday" },
  { key: "weekend", label: "Weekend" },
  { key: "other", label: "Other" },
];

export const CATEGORY_LABELS = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c.label]),
) as Record<Category, string>;

export const KID_COLORS = ["#f97316", "#0ea5e9", "#84cc16", "#e11d48", "#a855f7"];

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

let nodeCounter = 0;
function node(
  title: string,
  offsetDays: number | null,
  children: TemplateNode[] = [],
): TemplateNode {
  nodeCounter += 1;
  return { id: `tpl-node-${nodeCounter}`, title, offsetDays, children };
}

export function defaultTemplates(): TaskTemplate[] {
  nodeCounter = 0;
  return [
    {
      id: "tpl-camp",
      status: "camp",
      category: null,
      nodes: [
        node("Find camp", -120),
        node("Register & pay", -90),
        node("Pack list", -3),
      ],
    },
    {
      id: "tpl-childcare",
      status: "childcare",
      category: null,
      nodes: [
        node("Organize child care", -30, [
          node("Ask grandparents", -60),
          node("Book sitter", -45),
          node("Confirm", -14),
        ]),
      ],
    },
    {
      id: "tpl-grandparents",
      status: "grandparents",
      category: null,
      nodes: [
        node("Ask grandparents", -60),
        node("Confirm dates", -30),
        node("Arrange drop-off", -3),
      ],
    },
    {
      id: "tpl-vacation",
      status: "vacation",
      category: null,
      nodes: [
        node("Book accommodation", -120),
        node("Book travel", -90),
        node("Pack", -2),
      ],
    },
    {
      id: "tpl-guests",
      status: "guests",
      category: null,
      nodes: [
        node("Invite / confirm guests", -14),
        node("Plan meals", -7),
        node("Prepare the house", -2),
      ],
    },
    {
      id: "tpl-activity",
      status: "activity",
      category: null,
      nodes: [node("Pick an activity", -14), node("Book it", -7), node("Pack for it", -2)],
    },
    {
      id: "tpl-attending-birthday",
      status: "attending",
      category: "birthday",
      nodes: [node("RSVP", -14), node("Buy gift", -3)],
    },
    {
      id: "tpl-attending",
      status: "attending",
      category: null,
      nodes: [node("Check what to bring", -2)],
    },
  ];
}

export function defaultReminderTiers(): Record<Category, ReminderTierConfig> {
  const standard = { tiers: [180, 90, 30], repeatEveryDays: 7 };
  return {
    school: { ...standard, tiers: [...standard.tiers] },
    vacation: { ...standard, tiers: [...standard.tiers] },
    other: { ...standard, tiers: [...standard.tiers] },
    birthday: { tiers: [21, 7], repeatEveryDays: 2 },
    // Close-in only: a weekend every week would flood the inbox on the holiday ladder.
    weekend: { tiers: [14, 3], repeatEveryDays: 0 },
  };
}

export const SETTINGS_ID = "main";

export function defaultSettings(): Settings {
  return {
    id: SETTINGS_ID,
    statusColors: {},
    templates: defaultTemplates(),
    reminderTiers: defaultReminderTiers(),
    taskDueSoonDays: 3,
    corsProxy: "",
  };
}

/** Fill in fields missing from older stored settings docs. */
export function normalizeSettings(s: Partial<Settings> | null | undefined): Settings {
  const d = defaultSettings();
  if (!s) return d;
  return {
    ...d,
    ...s,
    statusColors: { ...d.statusColors, ...(s.statusColors ?? {}) },
    templates: s.templates ?? d.templates,
    reminderTiers: { ...d.reminderTiers, ...(s.reminderTiers ?? {}) },
  };
}

function canonicalStatusKey(key: string): StatusKey {
  if (key === "parentOff") return "parent_off";
  return key as StatusKey;
}

export function statusColor(settings: Settings | null | undefined, key: StatusKey | string): string {
  const canonical = canonicalStatusKey(key);
  const custom = settings?.statusColors?.[canonical] ?? settings?.statusColors?.[key as StatusKey];
  return custom ?? STATUS_DEFS.find((s) => s.key === canonical)?.color ?? "#9ca3af";
}
