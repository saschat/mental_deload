<script setup lang="ts">
import { computed } from "vue";
import { formatWeekendWeather } from "@/core/weather";
import type { FamilyEvent } from "@/core/types";
import { useDataStore } from "@/stores/data";
import { useWeatherStore } from "@/stores/weather";

const props = defineProps<{ event: Pick<FamilyEvent, "category" | "start" | "end"> }>();
const data = useDataStore();
const weather = useWeatherStore();
weather.ensure();

const line = computed(() => {
  const summary = weather.forEvent(props.event, data.today);
  return summary ? formatWeekendWeather(summary) : null;
});
</script>

<template>
  <div v-if="line" class="weekend-weather" data-testid="weekend-weather">
    <span>{{ line.temp }}</span>
    <span>{{ line.rain }}</span>
    <span v-if="line.snow">snow</span>
    <span class="source">{{ line.source }}</span>
  </div>
</template>

<style scoped>
.weekend-weather {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-2);
}
.source {
  font-size: 11px;
}
</style>
