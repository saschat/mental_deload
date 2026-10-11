import { today as todayIso } from "@/core/dates";
import type { ISODate } from "@/core/types";
import {
  climateQueryRange,
  FORECAST_URL,
  forecastByDate,
  parseOpenMeteoDaily,
  reduceClimate,
  ZURICH,
  type ClimateTable,
  type ForecastDay,
} from "@/core/weather";

export class WeatherFetchError extends Error {
  constructor(
    message: string,
    public readonly kind: "network" | "http",
  ) {
    super(message);
    this.name = "WeatherFetchError";
  }
}

/** Reuse a forecast for several hours so moving between screens does not refetch. */
export const FORECAST_CACHE_MS = 6 * 60 * 60 * 1000;

/** Typical weather changes slowly. A cache of many months is still shown. */
export const CLIMATE_CACHE_MS = 120 * 24 * 60 * 60 * 1000;

export const MIN_CLIMATE_DAYS = 300;

function archiveUrl(start: ISODate, end: ISODate): string {
  const params = new URLSearchParams({
    latitude: String(ZURICH.latitude),
    longitude: String(ZURICH.longitude),
    elevation: String(ZURICH.elevation),
    start_date: start,
    end_date: end,
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
    timezone: ZURICH.timezone,
  });
  return `https://archive-api.open-meteo.com/v1/archive?${params}`;
}

async function getJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new WeatherFetchError("Could not reach Open-Meteo.", "network");
  }
  if (!res.ok) {
    throw new WeatherFetchError(`Open-Meteo answered HTTP ${res.status}.`, "http");
  }
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && (body as { error?: unknown }).error === true) {
      throw new WeatherFetchError("Open-Meteo rejected the request.", "http");
    }
    return body;
  } catch (e) {
    if (e instanceof WeatherFetchError) throw e;
    throw new WeatherFetchError("Open-Meteo returned invalid JSON.", "http");
  }
}

export async function fetchZurichForecast(): Promise<Record<ISODate, ForecastDay>> {
  const days = forecastByDate(parseOpenMeteoDaily(await getJson(FORECAST_URL)));
  if (Object.keys(days).length === 0) {
    throw new WeatherFetchError("Open-Meteo forecast had no usable days.", "http");
  }
  return days;
}

export async function fetchZurichClimate(today: ISODate = todayIso()): Promise<ClimateTable> {
  const { start, end } = climateQueryRange(today);
  const table = reduceClimate(parseOpenMeteoDaily(await getJson(archiveUrl(start, end))));
  if (Object.keys(table).length < MIN_CLIMATE_DAYS) {
    throw new WeatherFetchError("Open-Meteo archive did not cover a full year of typical days.", "http");
  }
  return table;
}
