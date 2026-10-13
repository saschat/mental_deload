/**
 * Typical weather for outdoor ideas: daytime highs and rain chances per
 * region at 24 points a year (the 1st and 15th of each month), from ten years
 * of Open-Meteo history fetched by the indexer. A day takes the closest point.
 * Temperatures are moved to each place's altitude with the standard lapse
 * rate. Dependency-free so scripts/activities can import it at runtime.
 */

/** Grid size of a climate region, in degrees (about 55 × 38 km in Switzerland). */
export const CLIMATE_CELL_DEG = 0.5;

/** Daily precipitation at or above this counts as a rainy day. */
export const RAINY_DAY_MM = 1;

/** Air cools by about this much per km of height. */
export const LAPSE_C_PER_KM = 6.5;

/** Points per year: the 1st and 15th of every month. */
export const CLIMATE_POINTS = 24;

export interface CellClimate {
  /** Height the highs below refer to. */
  elevationM: number;
  /** Mean daily maximum per point (1 Jan, 15 Jan, 1 Feb …), °C. */
  high: number[];
  /** Share of days with rain per point, 0–100. */
  rain: number[];
}

/**
 * Index of the point closest to a date: days 1–7 belong to the 1st, 8–22 to
 * the 15th, and the rest of the month to the 1st of the next month.
 */
export function climatePoint(date: string): number {
  const m = Number(date.slice(5, 7)) - 1;
  const d = Number(date.slice(8, 10));
  if (d <= 7) return m * 2;
  if (d <= 22) return m * 2 + 1;
  return ((m + 1) % 12) * 2;
}

/** Region key of a point: its cell centre, "47.5,8.5". */
export function climateCell(lat: number, lng: number): string {
  const snap = (x: number) => Math.round(x / CLIMATE_CELL_DEG) * CLIMATE_CELL_DEG;
  return `${snap(lat)},${snap(lng)}`;
}

export interface DailyRow {
  /** "YYYY-MM-DD". */
  date: string;
  high: number | null;
  precipitationMm: number | null;
}

/** Normals per point from daily history; null when a point has no data. */
export function climateNormals(rows: readonly DailyRow[], elevationM: number): CellClimate | null {
  const highs = Array.from({ length: CLIMATE_POINTS }, () => [0, 0]);
  const rain = Array.from({ length: CLIMATE_POINTS }, () => [0, 0]);
  for (const r of rows) {
    const p = climatePoint(r.date);
    if (!(p >= 0 && p < CLIMATE_POINTS)) continue;
    if (typeof r.high === "number" && Number.isFinite(r.high)) {
      highs[p][0] += r.high;
      highs[p][1] += 1;
    }
    if (typeof r.precipitationMm === "number" && Number.isFinite(r.precipitationMm)) {
      rain[p][0] += r.precipitationMm >= RAINY_DAY_MM ? 1 : 0;
      rain[p][1] += 1;
    }
  }
  if (highs.some(([, n]) => !n) || rain.some(([, n]) => !n)) return null;
  return {
    elevationM: Math.round(elevationM),
    high: highs.map(([sum, n]) => Math.round((sum / n) * 10) / 10),
    rain: rain.map(([wet, n]) => Math.round((wet / n) * 100)),
  };
}

/** Longest stretch averaged; a summer holiday is about this long. */
const MAX_DAYS = 62;

/**
 * Typical daytime high and rain chance from `start` to `end` (inclusive), at
 * `altitudeM` if known: each day takes its closest point, and the days are
 * averaged. Null for data in an older format.
 */
export function typicalWeather(
  climate: CellClimate,
  start: string,
  end: string,
  altitudeM?: number,
): { high: number; rain: number } | null {
  if (climate.high?.length !== CLIMATE_POINTS || climate.rain?.length !== CLIMATE_POINTS) return null;
  let high = 0;
  let rain = 0;
  let n = 0;
  const day = new Date(`${start}T00:00:00Z`);
  for (; n < MAX_DAYS; n++) {
    const iso = day.toISOString().slice(0, 10);
    if (iso > end) break;
    const p = climatePoint(iso);
    high += climate.high[p];
    rain += climate.rain[p];
    day.setUTCDate(day.getUTCDate() + 1);
  }
  if (!n) return null;
  const lift = altitudeM === undefined ? 0 : ((altitudeM - climate.elevationM) / 1000) * LAPSE_C_PER_KM;
  return { high: Math.round(high / n - lift), rain: Math.round(rain / n) };
}
