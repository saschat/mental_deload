<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import KidAvatar from "./KidAvatar.vue";
import StatusChips from "./StatusChips.vue";
import { addDays, formatDate, formatRange, rangeLength } from "@/core/dates";
import {
  coverageDisplayName,
  ensureSegments,
  isUniform,
  removeSegment,
  segmentHeading,
  setSegmentName,
  setSegmentStatus,
  splitSegment,
} from "@/core/coverage";
import { STATUS_LABELS, statusColor } from "@/core/defaults";
import type { FamilyEvent, Segment, StatusKey } from "@/core/types";
import { useDataStore } from "@/stores/data";
import { useUiStore } from "@/stores/ui";
import { useStatusChange } from "@/composables/useStatusChange";

const props = defineProps<{ event: FamilyEvent }>();
const data = useDataStore();
const ui = useUiStore();
const { applySegments } = useStatusChange();

const kids = computed(() => data.relevantKids(props.event));
const kidIds = computed(() => kids.value.map((k) => k.id));
const segments = computed(() => ensureSegments(props.event));
const totalDays = computed(() => rangeLength(props.event.start, props.event.end));
const same = ref(true);
const splitting = ref<string | null>(null);
const splitDate = ref("");
const busy = ref(false);

watch(
  () => props.event.id,
  () => {
    same.value = isUniform(props.event.segments ?? [], kidIds.value);
  },
  { immediate: true },
);

function width(seg: Segment) {
  return `${(rangeLength(seg.start, seg.end) / totalDays.value) * 100}%`;
}

function cellStyle(seg: Segment, kidId: string) {
  const st = seg.statuses?.[kidId];
  return st ? { background: statusColor(data.settings, st) } : {};
}

function sharedStatus(seg: Segment): StatusKey | null {
  const values = kidIds.value.map((id) => seg.statuses?.[id] ?? null);
  return values.length && values.every((v) => v === values[0]) ? values[0] : null;
}

async function setStatus(seg: Segment, ids: string[], status: StatusKey) {
  if (busy.value) return;
  busy.value = true;
  const next = setSegmentStatus(segments.value, seg.id, ids, status);
  await applySegments(props.event, next, [seg.id]);
  busy.value = false;
}

function startSplit(seg: Segment) {
  splitting.value = seg.id;
  const mid = Math.max(1, Math.min(7, Math.floor(rangeLength(seg.start, seg.end) / 2)));
  splitDate.value = addDays(seg.start, mid);
}

async function doSplit(seg: Segment) {
  if (!(splitDate.value > seg.start && splitDate.value <= seg.end)) {
    ui.toast(`Pick a date after ${formatDate(seg.start)} and up to ${formatDate(seg.end)}.`, "error");
    return;
  }
  const next = splitSegment(segments.value, seg.id, splitDate.value);
  splitting.value = null;
  if (same.value && kids.value.length > 1) same.value = isUniform(next, kidIds.value);
  await ui.run(() => data.saveEvent({ ...props.event, segments: next }));
}

async function remove(seg: Segment) {
  const next = removeSegment(segments.value, seg.id);
  await ui.run(() => data.saveEvent({ ...props.event, segments: next }));
}

function heading(seg: Segment) {
  return segmentHeading(props.event, seg);
}

function namePlaceholder(seg: Segment) {
  const st = sharedStatus(seg);
  if (st) return STATUS_LABELS[st];
  return coverageDisplayName({ ...seg, name: undefined }) || "Coverage name";
}

/** Rename only. Status changes still go through task replacement; a new name does not. */
async function rename(seg: Segment, raw: string) {
  if (raw.trim() === (seg.name?.trim() ?? "")) return;
  const next = setSegmentName(segments.value, seg.id, raw);
  await ui.run(() => data.saveEvent({ ...props.event, segments: next }));
}
</script>

<template>
  <div>
    <div class="timeline">
      <div v-for="k in kids" :key="k.id" class="tl-row">
        <KidAvatar :kid="k" :size="24" />
        <div class="tl-bar">
          <div
            v-for="seg in segments"
            :key="seg.id"
            class="tl-seg"
            :class="{ empty: !seg.statuses?.[k.id] }"
            :style="{ width: width(seg), ...cellStyle(seg, k.id) }"
            :title="`${formatRange(seg.start, seg.end)}: ${seg.name?.trim() || (seg.statuses?.[k.id] ? STATUS_LABELS[seg.statuses[k.id]] : 'undecided')}`"
          />
        </div>
      </div>
      <div class="tl-dates small muted">
        <span>{{ formatDate(event.start) }}</span>
        <span>{{ formatDate(event.end) }}</span>
      </div>
    </div>

    <label v-if="kids.length > 1" class="row" style="margin: 4px 0 10px">
      <span class="switch"><input v-model="same" type="checkbox" /><span /></span>
      <span>Same for {{ kids.length === 2 ? "both kids" : "all kids" }}</span>
    </label>

    <fieldset :disabled="data.readOnly || busy">
      <div v-for="(seg, i) in segments" :key="seg.id" class="seg card flat">
        <div class="row">
          <strong v-if="heading(seg)">{{ heading(seg) }}</strong>
          <strong v-else-if="segments.length > 1">Part {{ i + 1 }}</strong>
          <span class="small muted">{{ formatRange(seg.start, seg.end) }} · {{ rangeLength(seg.start, seg.end) }} day{{ rangeLength(seg.start, seg.end) === 1 ? "" : "s" }}</span>
          <span class="spacer" />
          <button v-if="seg.start < seg.end" class="icon-btn" title="Split segment" @click="startSplit(seg)">
            <AppIcon name="split" :size="18" />
          </button>
          <button v-if="segments.length > 1" class="icon-btn" title="Merge into neighbour" @click="remove(seg)">
            <AppIcon name="merge" :size="18" />
          </button>
        </div>
        <div v-if="splitting === seg.id" class="row wrap split">
          <span class="small">New part starts on</span>
          <input v-model="splitDate" type="date" class="date-input" :min="addDays(seg.start, 1)" :max="seg.end" />
          <button class="btn tonal" @click="doSplit(seg)">Split</button>
          <button class="btn text" @click="splitting = null">Cancel</button>
        </div>
        <label class="name-field">
          <span class="small muted">Name</span>
          <input
            class="input"
            :value="seg.name ?? ''"
            :placeholder="namePlaceholder(seg)"
            aria-label="Coverage name"
            @change="rename(seg, ($event.target as HTMLInputElement).value)"
          />
        </label>
        <template v-if="same || kids.length < 2">
          <StatusChips :model-value="sharedStatus(seg)" @update:model-value="(s) => setStatus(seg, kidIds, s)" />
        </template>
        <template v-else>
          <div v-for="k in kids" :key="k.id" class="per-kid">
            <div class="row small"><KidAvatar :kid="k" :status="seg.statuses?.[k.id] ?? null" :size="22" /> {{ k.name }}</div>
            <StatusChips :model-value="seg.statuses?.[k.id]" @update:model-value="(s) => setStatus(seg, [k.id], s)" />
          </div>
        </template>
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.timeline {
  margin-bottom: 8px;
}
.tl-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.tl-bar {
  flex: 1;
  display: flex;
  height: 18px;
  border-radius: 9px;
  overflow: hidden;
  gap: 2px;
}
.tl-seg {
  min-width: 4px;
  height: 100%;
}
.tl-seg.empty {
  background: repeating-linear-gradient(45deg, var(--surface-3), var(--surface-3) 4px, var(--surface-2) 4px, var(--surface-2) 8px);
}
.tl-dates {
  display: flex;
  justify-content: space-between;
  padding-left: 32px;
}
.seg {
  padding: 10px 12px;
}
.split {
  margin: 6px 0;
}
.name-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0 4px;
}
.name-field .input {
  padding: 8px 10px;
}
.per-kid {
  margin-top: 4px;
}
</style>
