import { describe, expect, it } from "vitest";
import { defaultTemplates, STATUSES, STATUS_LABELS, statusColor, statusLabel } from "./defaults";
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
