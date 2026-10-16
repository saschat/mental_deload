import { describe, expect, it } from "vitest";
import { defaultTemplates, normalizeSettings, STATUSES, STATUS_LABELS, statusColor, statusLabel } from "./defaults";
import type { Settings } from "./types";

describe("coverage statuses", () => {
  it("offers guests and activity and keeps parent off readable", () => {
    const keys = STATUSES.map((s) => s.key);
    expect(keys).not.toContain("parent_off");
    expect(keys).toEqual(
      expect.arrayContaining(["childcare", "grandparents", "vacation", "camp", "attending", "guests", "activity", "not_relevant"]),
    );
    expect(new Set(STATUSES.map((s) => s.color)).size).toBe(STATUSES.length);

    expect(STATUS_LABELS.parent_off).toBe("Parent off");
    expect(statusLabel("parentOff")).toBe("Parent off");
    expect(statusColor(null, "parent_off")).toBe("#14b8a6");
    expect(statusColor(null, "parentOff")).toBe("#14b8a6");
    const tinted = { statusColors: { parent_off: "#111111" } } as Settings;
    expect(statusColor(tinted, "parentOff")).toBe("#111111");

    const templates = defaultTemplates();
    expect(templates.map((t) => t.status)).not.toContain("parent_off");
    expect(templates.find((t) => t.status === "guests")?.nodes.map((n) => [n.title, n.offsetDays])).toEqual([
      ["Invite / confirm guests", -14],
      ["Plan meals", -7],
      ["Prepare the house", -2],
    ]);
    expect(templates.find((t) => t.status === "activity")?.nodes.map((n) => [n.title, n.offsetDays])).toEqual([
      ["Pick an activity", -14],
      ["Book it", -7],
      ["Pack for it", -2],
    ]);
  });
});

describe("vacation template", () => {
  const vacation = (s: Settings) => s.templates.find((t) => t.status === "vacation")!.nodes.map((n) => [n.title, n.offsetDays]);

  it("books a rental car two months ahead", () => {
    expect(vacation(normalizeSettings(null))).toEqual([
      ["Book accommodation", -120],
      ["Book travel", -90],
      ["Book car rental", -60],
      ["Pack", -2],
    ]);
  });

  it("adds the rental car to stored templates once", () => {
    const old = defaultTemplates().map((t) =>
      t.status === "vacation" ? { ...t, nodes: t.nodes.filter((n) => n.title !== "Book car rental") } : t,
    );
    const upgraded = normalizeSettings({ templates: old });
    expect(vacation(upgraded).map(([title]) => title)).toEqual(["Book accommodation", "Book travel", "Book car rental", "Pack"]);
    expect(upgraded.templatesRev).toBe(1);
    // Deleted after the upgrade: stays deleted.
    expect(vacation(normalizeSettings({ templates: old, templatesRev: 1 })).map(([title]) => title)).not.toContain("Book car rental");
    // Already there under another name: not added twice.
    const own = old.map((t) => (t.status === "vacation" ? { ...t, nodes: [...t.nodes, { id: "x", title: "Mietauto reservieren", children: [] }] } : t));
    expect(vacation(normalizeSettings({ templates: own })).filter(([title]) => /car rental|mietauto/i.test(String(title)))).toHaveLength(1);
  });
});
