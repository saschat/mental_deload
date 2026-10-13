/**
 * Typical weather for outdoor ideas: monthly daytime highs and rain chances
 * per region, from ten years of Open-Meteo history fetched by the indexer.
 * Temperatures are moved to each place's altitude with the standard lapse
 * rate. Dependency-free so scripts/activities can import it at runtime.
 */

/** Grid size of a climate region, in degrees (about 55 × 38 km in Switzerland). */
export const CLIMATE_CELL_DEG = 0.5;

/** Daily precipitation at or above this counts as a rainy day. */
export const RAINY_DAY_MM = 1;

/** Air cools by about this much per km of height. */
export const LAPSE_C_PER_KM = 6.5;

export interface CellClimate {
  /** Height the highs below refer to. */
  elevationM: number;
  /** Mean daily maximum per month, January first, °C. */
  high: number[];
  /** Share of days with rain per month, 0–100. */
  rain: number[];
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

/** Monthly normals from daily history; null when a month has no data. */
export function monthlyNormals(rows: readonly DailyRow[], elevationM: number): CellClimate | null {
  const highs = Array.from({ length: 12 }, () => [0, 0]);
  const rain = Array.from({ length: 12 }, () => [0, 0]);
  for (const r of rows) {
    const m = Number(r.date.slice(5, 7)) - 1;
    if (!(m >= 0 && m < 12)) continue;
    if (typeof r.high === "number" && Number.isFinite(r.high)) {
      highs[m][0] += r.high;
      highs[m][1] += 1;
    }
    if (typeof r.precipitationMm === "number" && Number.isFinite(r.precipitationMm)) {
      rain[m][0] += r.precipitationMm >= RAINY_DAY_MM ? 1 : 0;
      rain[m][1] += 1;
    }
  }
  if (highs.some(([, n]) => !n) || rain.some(([, n]) => !n)) return null;
  return {
    elevationM: Math.round(elevationM),
    high: highs.map(([sum, n]) => Math.round((sum / n) * 10) / 10),
    rain: rain.map(([wet, n]) => Math.round((wet / n) * 100)),
  };
}

/** Typical daytime high and rain chance over the given months, at `altitudeM` if known. */
export function typicalWeather(
  climate: CellClimate,
  months: readonly number[],
  altitudeM?: number,
): { high: number; rain: number } | null {
  const ms = months.filter((m) => m >= 1 && m <= 12);
  if (!ms.length) return null;
  const avg = (xs: number[]) => ms.reduce((sum, m) => sum + xs[m - 1], 0) / ms.length;
  const lift = altitudeM === undefined ? 0 : ((altitudeM - climate.elevationM) / 1000) * LAPSE_C_PER_KM;
  return { high: Math.round(avg(climate.high) - lift), rain: Math.round(avg(climate.rain)) };
}
