import type {
  Category,
  ReminderTierConfig,
  Settings,
  StatusDef,
  StatusKey,
  TaskTemplate,
  TemplateNode,
} from "./types";

export const STATUSES: StatusDef[] = [
  { key: "childcare", label: "Child care", color: "#3b82f6" },
  { key: "grandparents", label: "Grandparents", color: "#8b5cf6" },
  { key: "vacation", label: "Family vacation", color: "#10b981" },
  { key: "parent_off", label: "Parent off", color: "#14b8a6" },
  { key: "camp", label: "Holiday camp", color: "#f59e0b" },
  { key: "attending", label: "Attending", color: "#ec4899" },
  { key: "not_relevant", label: "Not relevant", color: "#9ca3af" },
];

export const STATUS_LABELS = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.label]),
) as Record<StatusKey, string>;

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
      id: "tpl-parent-off",
      status: "parent_off",
      category: null,
      nodes: [node("Request time off at work", -60), node("Plan activities", -7)],
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

export function statusColor(settings: Settings | null | undefined, key: StatusKey): string {
  return settings?.statusColors?.[key] ?? STATUSES.find((s) => s.key === key)!.color;
}
