<script setup lang="ts">
import { computed } from "vue";
import KidAvatar from "./KidAvatar.vue";
import { formatRange, relativeDays } from "@/core/dates";
import { isKidDecided } from "@/core/coverage";
import { CATEGORY_LABELS } from "@/core/defaults";
import type { FamilyEvent } from "@/core/types";
import { URGENCY_COLORS, timeLabel, urgency } from "@/lib/eventMeta";
import { useDataStore } from "@/stores/data";

const props = defineProps<{ event: FamilyEvent }>();
const emit = defineEmits<{ setStatus: [FamilyEvent] }>();
const data = useDataStore();

const bar = computed(() => URGENCY_COLORS[urgency(props.event, data.today)]);
const kids = computed(() => data.relevantKids(props.event));

function kidStatus(kidId: string) {
  return (props.event.segments ?? []).map((s) => s.statuses?.[kidId]).find(Boolean) ?? null;
}
function partial(kidId: string) {
  return kidStatus(kidId) !== null && !isKidDecided(props.event, kidId);
}
</script>

<template>
  <div class="card event-card">
    <span class="bar" :style="{ background: bar }" />
    <RouterLink :to="`/event/${event.id}`" class="body">
      <div class="row">
        <strong class="title">{{ event.title }}</strong>
      </div>
      <div class="small muted">
        {{ formatRange(event.start, event.end) }}
        <template v-if="timeLabel(event)"> · {{ timeLabel(event) }}</template>
        · <strong>{{ relativeDays(event.start, data.today) }}</strong>
      </div>
      <div class="row wrap tags">
        <span class="tag">{{ CATEGORY_LABELS[event.category] }}</span>
        <span v-if="event.upstreamFlag === 'changed'" class="tag warn">Changed upstream</span>
        <span v-if="event.upstreamFlag === 'removed'" class="tag danger">Removed upstream</span>
      </div>
    </RouterLink>
    <div class="row foot">
      <KidAvatar
        v-for="k in kids"
        :key="k.id"
        :kid="k"
        :status="kidStatus(k.id)"
        :partial="partial(k.id)"
        :size="30"
      />
      <span class="spacer" />
      <button class="btn tonal" :disabled="data.readOnly" @click="emit('setStatus', event)">Set status</button>
    </div>
  </div>
</template>

<style scoped>
.event-card {
  padding-left: 20px;
}
.bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
}
.body {
  display: block;
  color: inherit;
  text-decoration: none;
}
.title {
  font-size: 16px;
  font-weight: 500;
}
.tags {
  margin-top: 6px;
  gap: 6px;
}
.foot {
  margin-top: 10px;
}
</style>
