import { addDays } from "./dates";
import type { Category, ISODate } from "./types";

/** Zürich, hardcoded. Weekend weather is not per outing. */
export const ZURICH = {
  latitude: 47.3769,
  longitude: 8.5417,
  elevation: 408,
  timezone: "Europe/Zurich",
} as const;

/** Open-Meteo `forecast_days`, inclusive of today. */
export const FORECAST_DAYS = 16;

/** Daily precipitation at or above this counts as a wet year. */
export const RAIN_MM = 1;

/** Forecast snowfall at or above this is worth a short note. */
export const SNOW_CM = 1;

/** Archive lags a few days; stay behind the latest published day. */
export const CLIMATE_LAG_DAYS = 7;

export const CLIMATE_YEARS = 10;

export const FORECAST_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=47.3769&longitude=8.5417&elevation=408&forecast_days=16&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,snowfall_sum&timezone=Europe/Zurich";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DaySource = "forecast" | "typical";
export type WeekendSource = DaySource | "mixed";

export interface ForecastDay {
  high: number;
  low: number;
  /** 0–100. Null when the forecast omitted precipitation probability. */
  rainProbability: number | null;
  snowfallCm: number | null;
}

export interface ClimateNormal {
  high: number;
  low: number;
  /** 0–100. Fraction of years with precipitation ≥ 1 mm. */
  rainProbability: number;
}

/** Keyed by "MM-DD". February 29 is not stored. */
export type ClimateTable = Record<string, ClimateNormal>;

export interface ArchiveDay {
  date: string;
  high: number | null;
  low: number | null;
  precipitationMm: number | null;
}

export interface ParsedDaily extends ArchiveDay {
  rainProbability: number | null;
  snowfallCm: number | null;
}

export interface DayWeather {
  high: number;
  low: number;
  rainProbability: number;
  snowfallCm: number | null;
  /** "mixed" when the temperatures are a forecast but rain had to come from the climate table. */
  source: WeekendSource;
}

export interface WeekendWeather {
  high: number;
  low: number;
  rainProbability: number;
  snow: boolean;
  source: WeekendSource;
}

export interface WeekendWeatherText {
  temp: string;
  rain: string;
  snow: string | null;
  source: WeekendSource;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function realCalendarDay(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Last date included in a 16-day forecast that starts today. */
export function forecastWindowEnd(today: ISODate): ISODate {
  return addDays(today, FORECAST_DAYS - 1);
}

export function inForecastWindow(date: ISODate, today: ISODate): boolean {
  return date >= today && date <= forecastWindowEnd(today);
}

/**
 * Month-day key. Leap day folds onto 28 Feb so a lookup never misses a key
 * the climate table does not store.
 */
export function monthDayKey(date: string): string | null {
  const match = ISO_DATE.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!realCalendarDay(year, month, day)) return null;
  if (month === 2 && day === 29) return "02-28";
  return `${match[2]}-${match[3]}`;
}

export function climateQueryRange(today: ISODate): { start: ISODate; end: ISODate } {
  const end = addDays(today, -CLIMATE_LAG_DAYS);
  const [y, m, d] = end.split("-").map(Number);
  const year = y - CLIMATE_YEARS;
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { start: `${year}-${pad(m)}-${pad(Math.min(d, last))}`, end };
}

export function parseOpenMeteoDaily(body: unknown): ParsedDaily[] {
  if (!body || typeof body !== "object") return [];
  const daily = (body as { daily?: unknown }).daily;
  if (!daily || typeof daily !== "object") return [];
  const block = daily as Record<string, unknown>;
  const time = block.time;
  if (!Array.isArray(time)) return [];
  const highs = Array.isArray(block.temperature_2m_max) ? block.temperature_2m_max : [];
  const lows = Array.isArray(block.temperature_2m_min) ? block.temperature_2m_min : [];
  const precips = Array.isArray(block.precipitation_sum) ? block.precipitation_sum : [];
  const rains = Array.isArray(block.precipitation_probability_max) ? block.precipitation_probability_max : [];
  const snows = Array.isArray(block.snowfall_sum) ? block.snowfall_sum : [];
  const rows: ParsedDaily[] = [];
  for (let i = 0; i < time.length; i++) {
    const date = time[i];
    if (typeof date !== "string" || !ISO_DATE.test(date)) continue;
    const rain = finite(rains[i]) ? Math.min(100, Math.max(0, rains[i])) : null;
    rows.push({
      date,
      high: finite(highs[i]) ? highs[i] : null,
      low: finite(lows[i]) ? lows[i] : null,
      precipitationMm: finite(precips[i]) ? precips[i] : null,
      rainProbability: rain,
      snowfallCm: finite(snows[i]) ? snows[i] : null,
    });
  }
  return rows;
}

export function forecastByDate(rows: readonly ParsedDaily[]): Record<ISODate, ForecastDay> {
  const table: Record<ISODate, ForecastDay> = {};
  for (const row of rows) {
    if (row.high === null || row.low === null) continue;
    table[row.date] = {
      high: row.high,
      low: row.low,
      rainProbability: row.rainProbability,
      snowfallCm: row.snowfallCm,
    };
  }
  return table;
}

/**
 * Mean high, mean low, and wet-year fraction for each month-day.
 * 29 Feb is skipped so it does not shift the day-of-year after February.
 */
export function reduceClimate(rows: readonly ArchiveDay[]): ClimateTable {
  const acc = new Map<string, { highSum: number; highN: number; lowSum: number; lowN: number; wet: number; precipN: number }>();
  for (const row of rows) {
    const match = ISO_DATE.exec(row.date);
    if (!match) continue;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month === 2 && day === 29) continue;
    if (!realCalendarDay(year, month, day)) continue;
    const key = `${match[2]}-${match[3]}`;
    let bucket = acc.get(key);
    if (!bucket) {
      bucket = { highSum: 0, highN: 0, lowSum: 0, lowN: 0, wet: 0, precipN: 0 };
      acc.set(key, bucket);
    }
    if (finite(row.high)) {
      bucket.highSum += row.high;
      bucket.highN += 1;
    }
    if (finite(row.low)) {
      bucket.lowSum += row.low;
      bucket.lowN += 1;
    }
    if (finite(row.precipitationMm)) {
      bucket.precipN += 1;
      if (row.precipitationMm >= RAIN_MM) bucket.wet += 1;
    }
  }
  const table: ClimateTable = {};
  for (const [key, bucket] of acc) {
    if (bucket.highN === 0 || bucket.lowN === 0 || bucket.precipN === 0) continue;
    table[key] = {
      high: bucket.highSum / bucket.highN,
      low: bucket.lowSum / bucket.lowN,
      rainProbability: (bucket.wet / bucket.precipN) * 100,
    };
  }
  return table;
}

function climateNormal(climate: ClimateTable, date: string): ClimateNormal | null {
  const key = monthDayKey(date);
  const normal = key ? climate[key] : undefined;
  if (!normal || !finite(normal.high) || !finite(normal.low) || !finite(normal.rainProbability)) return null;
  return normal;
}

export function resolveDay(
  date: ISODate,
  today: ISODate,
  forecast: Readonly<Record<string, ForecastDay>>,
  climate: ClimateTable,
): DayWeather | null {
  if (inForecastWindow(date, today)) {
    const day = forecast[date];
    if (day && finite(day.high) && finite(day.low)) {
      const snow = finite(day.snowfallCm) ? day.snowfallCm : null;
      if (finite(day.rainProbability)) {
        return { high: day.high, low: day.low, rainProbability: day.rainProbability, snowfallCm: snow, source: "forecast" };
      }
      const normal = climateNormal(climate, date);
      if (normal) {
        return {
          high: day.high,
          low: day.low,
          rainProbability: normal.rainProbability,
          snowfallCm: snow,
          source: "mixed",
        };
      }
      return null;
    }
  }
  const normal = climateNormal(climate, date);
  if (!normal) return null;
  return {
    high: normal.high,
    low: normal.low,
    rainProbability: normal.rainProbability,
    snowfallCm: null,
    source: "typical",
  };
}

/** Higher high, lower low, and the wetter of the two days. */
export function combineWeekend(saturday: DayWeather, sunday: DayWeather): WeekendWeather {
  const snow = [saturday, sunday].some((day) => finite(day.snowfallCm) && day.snowfallCm >= SNOW_CM);
  return {
    high: Math.max(saturday.high, sunday.high),
    low: Math.min(saturday.low, sunday.low),
    rainProbability: Math.max(saturday.rainProbability, sunday.rainProbability),
    snow,
    source: saturday.source === sunday.source ? saturday.source : "mixed",
  };
}

export function weekendWeather(args: {
  start: ISODate;
  end: ISODate;
  today: ISODate;
  forecast: Readonly<Record<string, ForecastDay>>;
  climate: ClimateTable;
}): WeekendWeather | null {
  if (!(args.end > args.start)) return null;
  const saturday = resolveDay(args.start, args.today, args.forecast, args.climate);
  const sunday = resolveDay(args.end, args.today, args.forecast, args.climate);
  if (!saturday || !sunday) return null;
  return combineWeekend(saturday, sunday);
}

export function eventWeekendWeather(
  event: { category: Category; start: ISODate; end: ISODate },
  today: ISODate,
  forecast: Readonly<Record<string, ForecastDay>>,
  climate: ClimateTable,
): WeekendWeather | null {
  if (event.category !== "weekend") return null;
  return weekendWeather({ start: event.start, end: event.end, today, forecast, climate });
}

export function formatWeekendWeather(weather: WeekendWeather): WeekendWeatherText {
  return {
    temp: `${Math.round(weather.high)}° / ${Math.round(weather.low)}°`,
    rain: `rain ${Math.round(weather.rainProbability)}%`,
    snow: weather.snow ? "snow" : null,
    source: weather.source,
  };
}
