<script setup lang="ts">
import { computed } from "vue";
import { formatWeekendWeather } from "@/core/weather";
import type { FamilyEvent } from "@/core/types";
import { useDataStore } from "@/stores/data";
import { useWeatherStore } from "@/stores/weather";

const props = defineProps<{
  event: Pick<FamilyEvent, "category" | "start" | "end">;
  /** Event page shows daytime high and nighttime low. Lists stay on the daytime high. */
  showNight?: boolean;
}>();
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
    <span v-if="line.source === 'forecast'" class="live" role="img" aria-label="forecast" title="forecast" />
    <span v-if="showNight">{{ line.temp }} / {{ line.night }}</span>
    <span v-else>{{ line.temp }}</span>
    <span class="rain">
      <svg class="drop" viewBox="0 0 24 24" width="12.6" height="12.6" role="img" aria-label="rain">
        <title>rain</title>
        <path d="M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2C20 10.48 17.33 6.55 12 2z" />
      </svg>
      <span>{{ line.rain }}</span>
    </span>
  </div>
</template>

<style scoped>
.weekend-weather {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-2);
}
.live {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4caf50;
  flex: none;
}
.rain {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}
.drop {
  display: block;
  flex: none;
  fill: #2196f3;
}
</style>
