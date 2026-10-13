<script setup lang="ts">
import { computed, ref, watch } from "vue";
import BottomSheet from "@/components/BottomSheet.vue";
import KidAvatar from "@/components/KidAvatar.vue";
import type { Activity, ActivityDate } from "@/core/activities";
import { placeBlock } from "@/core/coverage";
import { addDays, formatDate } from "@/core/dates";
import type { IdeaTarget } from "@/core/ideaTargets";
import type { FamilyEvent, ISODate, StatusKey } from "@/core/types";
import { useStatusChange } from "@/composables/useStatusChange";
import { useDataStore } from "@/stores/data";
import { useUiStore } from "@/stores/ui";

const props = defineProps<{
  activity: Activity | null;
  /** The activity's dates within the target, for camps and events. */
  dates?: ActivityDate[];
  target: IdeaTarget;
}>();
const emit = defineEmits<{ close: [] }>();

const data = useDataStore();
const ui = useUiStore();
const { applySegments } = useStatusChange();

/** Longer holidays list their days in weeks; more than this is not useful to tap through. */
const MAX_DAYS = 63;

const event = computed(() => (props.target.eventId ? data.eventsById.get(props.target.eventId) : undefined));
const kids = computed(() => (event.value ? data.relevantKids(event.value) : data.sortedKids));

const days = computed(() => {
  const out: ISODate[] = [];
  for (let d = props.target.start; d <= props.target.end && out.length < MAX_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
});

const selectedDays = ref<ISODate[]>([]);
const selectedKids = ref<string[]>([]);
const busy = ref(false);

watch(
  () => props.activity,
  (a) => {
    if (!a) return;
    const fromDates = days.value.filter((d) => (props.dates ?? []).some((x) => d >= x.start && d <= (x.end ?? x.start)));
    selectedDays.value = fromDates.length ? fromDates : days.value.slice(0, 1);
    selectedKids.value = kids.value.map((k) => k.id);
  },
);

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

/** Selected days as inclusive runs of consecutive days. */
const runs = computed(() => {
  const sorted = [...selectedDays.value].sort();
  const out: { start: ISODate; end: ISODate }[] = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && addDays(last.end, 1) === d) last.end = d;
    else out.push({ start: d, end: d });
  }
  return out;
});

function dayLabel(d: ISODate): string {
  return formatDate(d, { weekday: "short", day: "numeric", month: days.value.length > 7 ? "short" : undefined });
}

async function save() {
  const a = props.activity;
  if (!a || !runs.value.length || busy.value) return;
  busy.value = true;
  // A weekend without a calendar event gets one, so the plan has a home.
  const base: FamilyEvent =
    event.value ??
    data.newManualEvent({
      title: "Weekend",
      category: "weekend",
      start: props.target.key.startsWith("weekend:") ? props.target.key.slice("weekend:".length) : props.target.start,
      end: props.target.end,
      kidIds: [],
    });
  const statuses: Record<string, StatusKey> = Object.fromEntries(selectedKids.value.map((id) => [id, "activity" as StatusKey]));
  let segments = base.segments ?? [];
  const ids: string[] = [];
  for (const r of runs.value) {
    const placed = placeBlock({ ...base, segments }, r.start, r.end, statuses, a.title);
    segments = placed.segments;
    ids.push(placed.id);
  }
  const ok = await applySegments(base, segments, ids);
  busy.value = false;
  if (ok) {
    ui.toast(`Added to ${props.target.title}`);
    emit("close");
  }
}
</script>

<template>
  <BottomSheet :open="!!activity" :title="activity ? `Add ${activity.title}` : ''" @close="emit('close')">
    <template v-if="activity">
      <p class="small muted lead">As an activity in {{ target.title }}. Pick the days{{ kids.length > 1 ? " and kids" : "" }}.</p>
      <div class="chips wrap">
        <button
          v-for="d in days"
          :key="d"
          class="chip"
          :class="{ selected: selectedDays.includes(d) }"
          @click="selectedDays = toggle(selectedDays, d)"
        >
          {{ dayLabel(d) }}
        </button>
      </div>
      <div v-if="kids.length > 1" class="chips wrap">
        <button
          v-for="k in kids"
          :key="k.id"
          class="chip"
          :class="{ selected: selectedKids.includes(k.id) }"
          @click="selectedKids = toggle(selectedKids, k.id)"
        >
          <KidAvatar :kid="k" :size="18" /> {{ k.name }}
        </button>
      </div>
      <div class="row actions">
        <span class="spacer" />
        <button class="btn text" @click="emit('close')">Cancel</button>
        <button class="btn primary" :disabled="!runs.length || busy || data.readOnly" @click="save">Add</button>
      </div>
    </template>
  </BottomSheet>
</template>

<style scoped>
.lead {
  margin: -6px 0 8px;
}
.actions {
  margin-top: 8px;
}
</style>
