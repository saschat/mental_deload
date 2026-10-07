<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import BottomSheet from "./BottomSheet.vue";
import StatusChips from "./StatusChips.vue";
import KidAvatar from "./KidAvatar.vue";
import { formatRange } from "@/core/dates";
import { fullSegment, setStatusForAll } from "@/core/coverage";
import type { FamilyEvent, StatusKey } from "@/core/types";
import { useDataStore } from "@/stores/data";
import { useStatusChange } from "@/composables/useStatusChange";

const props = defineProps<{ event: FamilyEvent | null }>();
const emit = defineEmits<{ close: [] }>();

const data = useDataStore();
const router = useRouter();
const { applySegments } = useStatusChange();

const same = ref(true);
const perKid = ref<Record<string, StatusKey | null>>({});
const busy = ref(false);

const kids = computed(() => (props.event ? data.relevantKids(props.event) : []));
const split = computed(() => (props.event?.segments?.length ?? 0) > 1);
const current = computed(() => props.event?.segments?.[0]?.statuses ?? {});
const sharedStatus = computed(() => {
  const values = kids.value.map((k) => current.value[k.id] ?? null);
  return values.length && values.every((v) => v === values[0]) ? values[0] : null;
});

watch(
  () => props.event?.id,
  () => {
    perKid.value = Object.fromEntries(kids.value.map((k) => [k.id, current.value[k.id] ?? null]));
    same.value = kids.value.length < 2 || sharedStatus.value !== null || Object.keys(current.value).length === 0;
  },
  { immediate: true },
);

async function setAll(status: StatusKey) {
  if (!props.event || busy.value) return;
  busy.value = true;
  const ev = props.event;
  const segments = setStatusForAll(ev, kids.value.map((k) => k.id), status);
  const ok = await applySegments(ev, segments);
  busy.value = false;
  if (ok) emit("close");
}

async function savePerKid() {
  if (!props.event || busy.value) return;
  busy.value = true;
  const ev = props.event;
  const base = ev.segments?.[0] ?? fullSegment(ev);
  const statuses = Object.fromEntries(Object.entries(perKid.value).filter(([, v]) => v)) as Record<string, StatusKey>;
  const ok = await applySegments(ev, [{ ...base, start: ev.start, end: ev.end, statuses }]);
  busy.value = false;
  if (ok) emit("close");
}

function openDetail() {
  if (!props.event) return;
  router.push(`/event/${props.event.id}`);
  emit("close");
}
</script>

<template>
  <BottomSheet :open="!!event" :title="event ? `Set status · ${event.title}` : ''" @close="emit('close')">
    <template v-if="event">
      <p class="muted small" style="margin-top: -6px">{{ formatRange(event.start, event.end) }}</p>
      <div v-if="split" class="banner info">
        This event is split into {{ event.segments.length }} segments.
        <button class="btn text" @click="openDetail">Edit segments</button>
      </div>
      <fieldset :disabled="data.readOnly || busy">
        <label v-if="kids.length > 1" class="row" style="margin: 8px 0 12px">
          <span class="switch"><input v-model="same" type="checkbox" /><span /></span>
          <span>Same for {{ kids.length === 2 ? "both kids" : "all kids" }}</span>
        </label>
        <template v-if="same">
          <div class="row" style="margin-bottom: 6px">
            <KidAvatar v-for="k in kids" :key="k.id" :kid="k" :status="current[k.id] ?? null" :size="28" />
          </div>
          <StatusChips :model-value="sharedStatus" @update:model-value="setAll" />
          <p v-if="split" class="small muted">Choosing a status here replaces all segments with one.</p>
        </template>
        <template v-else>
          <div v-for="k in kids" :key="k.id" style="margin-bottom: 10px">
            <div class="row" style="margin-bottom: 4px">
              <KidAvatar :kid="k" :status="perKid[k.id] ?? null" :size="28" />
              <strong>{{ k.name }}</strong>
            </div>
            <StatusChips v-model="perKid[k.id]" />
          </div>
          <div class="row">
            <span class="spacer" />
            <button class="btn primary" @click="savePerKid">Save</button>
          </div>
        </template>
      </fieldset>
      <div class="row" style="margin-top: 8px">
        <button class="btn text" @click="openDetail">Open details</button>
      </div>
    </template>
  </BottomSheet>
</template>
