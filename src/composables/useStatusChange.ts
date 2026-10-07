import type { FamilyEvent, Segment } from "@/core/types";
import { useDataStore } from "@/stores/data";
import { useUiStore } from "@/stores/ui";

/**
 * Persist new segments for an event and generate template tasks, asking the
 * user whether to replace tasks that belonged to a previous status.
 */
export function useStatusChange() {
  const data = useDataStore();
  const ui = useUiStore();

  async function applySegments(ev: FamilyEvent, segments: Segment[], changedSegmentIds?: string[]): Promise<boolean> {
    const plan = data.planSegments(ev, segments, changedSegmentIds);
    let replace = false;
    if (plan.stale.length) {
      const done = plan.stale.filter((t) => t.done).length;
      const choice = await ui.ask(
        "Replace tasks?",
        `${plan.stale.length} task${plan.stale.length === 1 ? "" : "s"} were generated for the previous status` +
          (done ? ` (${done} already done)` : "") +
          (plan.create.length ? `. ${plan.create.length} new task${plan.create.length === 1 ? "" : "s"} will be added.` : "."),
        [
          { value: "cancel", label: "Cancel" },
          { value: "keep", label: "Keep old tasks" },
          { value: "replace", label: "Replace", primary: true },
        ],
      );
      if (!choice || choice === "cancel") return false;
      replace = choice === "replace";
    }
    const ok = await ui.run(async () => {
      await data.commitSegments(ev, segments, plan, replace);
      return true;
    });
    if (ok && plan.create.length) ui.toast(`Added ${plan.create.length} task${plan.create.length === 1 ? "" : "s"}`);
    return !!ok;
  }

  return { applySegments };
}
