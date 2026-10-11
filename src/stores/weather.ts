import { ref } from "vue";
import { defineStore } from "pinia";

import { eventWeekendWeather, type ClimateNormal, type ClimateTable, type ForecastDay, type WeekendWeather } from "@/core/weather";
import { idbGet, idbSet, WEATHER_CLIMATE_KEY, WEATHER_FORECAST_KEY } from "@/lib/idb";
import { CLIMATE_CACHE_MS, fetchZurichClimate, fetchZurichForecast, FORECAST_CACHE_MS, MIN_CLIMATE_DAYS } from "@/lib/weather";
import type { Category, ISODate } from "@/core/types";

interface ForecastCache {
  v: 1;
  fetchedAt: number;
  days: Record<string, ForecastDay>;
}

interface ClimateCache {
  v: 1;
  fetchedAt: number;
  table: ClimateTable;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readForecastCache(value: unknown): ForecastCache | null {
  if (!value || typeof value !== "object") return null;
  const row = value as ForecastCache;
  if (row.v !== 1 || !finite(row.fetchedAt) || !row.days || typeof row.days !== "object") return null;
  const days: Record<string, ForecastDay> = {};
  for (const [date, day] of Object.entries(row.days)) {
    if (!day || typeof day !== "object") continue;
    if (!finite(day.high) || !finite(day.low)) continue;
    days[date] = {
      high: day.high,
      low: day.low,
      rainProbability: finite(day.rainProbability) ? day.rainProbability : null,
      snowfallCm: finite(day.snowfallCm) ? day.snowfallCm : null,
    };
  }
  if (Object.keys(days).length === 0) return null;
  return { v: 1, fetchedAt: row.fetchedAt, days };
}

function readClimateCache(value: unknown): ClimateCache | null {
  if (!value || typeof value !== "object") return null;
  const row = value as ClimateCache;
  if (row.v !== 1 || !finite(row.fetchedAt) || !row.table || typeof row.table !== "object") return null;
  const table: ClimateTable = {};
  for (const [key, day] of Object.entries(row.table as Record<string, ClimateNormal>)) {
    if (!day || typeof day !== "object") continue;
    if (!finite(day.high) || !finite(day.low) || !finite(day.rainProbability)) continue;
    table[key] = { high: day.high, low: day.low, rainProbability: day.rainProbability };
  }
  if (Object.keys(table).length === 0) return null;
  return { v: 1, fetchedAt: row.fetchedAt, table };
}

function expired(fetchedAt: number | null, ttl: number): boolean {
  return fetchedAt === null || Date.now() - fetchedAt >= ttl;
}

export const useWeatherStore = defineStore("weather", () => {
  const forecast = ref<Record<string, ForecastDay>>({});
  const climate = ref<ClimateTable>({});
  const forecastFetchedAt = ref<number | null>(null);
  const climateFetchedAt = ref<number | null>(null);
  let hydrated = false;
  let pending: Promise<void> | null = null;

  function forEvent(
    event: { category: Category; start: ISODate; end: ISODate },
    today: ISODate,
  ): WeekendWeather | null {
    return eventWeekendWeather(event, today, forecast.value, climate.value);
  }

  async function hydrate() {
    const [forecastRow, climateRow] = await Promise.all([
      idbGet<unknown>(WEATHER_FORECAST_KEY).catch(() => undefined),
      idbGet<unknown>(WEATHER_CLIMATE_KEY).catch(() => undefined),
    ]);
    const cachedForecast = readForecastCache(forecastRow);
    if (cachedForecast) {
      forecast.value = cachedForecast.days;
      forecastFetchedAt.value = cachedForecast.fetchedAt;
    }
    const cachedClimate = readClimateCache(climateRow);
    if (cachedClimate) {
      climate.value = cachedClimate.table;
      climateFetchedAt.value =
        Object.keys(cachedClimate.table).length >= MIN_CLIMATE_DAYS ? cachedClimate.fetchedAt : null;
    }
    hydrated = true;
  }

  async function refreshForecast() {
    try {
      const days = await fetchZurichForecast();
      const fetchedAt = Date.now();
      forecast.value = days;
      forecastFetchedAt.value = fetchedAt;
      await idbSet(WEATHER_FORECAST_KEY, { v: 1 as const, fetchedAt, days }).catch((e) =>
        console.warn("Could not cache forecast", e),
      );
    } catch (e) {
      console.warn("Weather forecast unavailable", e);
    }
  }

  async function refreshClimate() {
    try {
      const table = await fetchZurichClimate();
      const fetchedAt = Date.now();
      climate.value = table;
      climateFetchedAt.value = fetchedAt;
      await idbSet(WEATHER_CLIMATE_KEY, { v: 1 as const, fetchedAt, table }).catch((e) =>
        console.warn("Could not cache typical weather", e),
      );
    } catch (e) {
      console.warn("Typical weather unavailable", e);
    }
  }

  /** Load cached Zürich weather, then refresh the forecast and climatology if they are stale. */
  function ensure() {
    if (pending) return;
    pending = (async () => {
      if (!hydrated) await hydrate();
      const jobs: Promise<void>[] = [];
      if (expired(forecastFetchedAt.value, FORECAST_CACHE_MS)) jobs.push(refreshForecast());
      if (expired(climateFetchedAt.value, CLIMATE_CACHE_MS)) jobs.push(refreshClimate());
      await Promise.all(jobs);
    })().finally(() => {
      pending = null;
    });
  }

  return { forEvent, ensure };
});
