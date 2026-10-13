// Typical weather per region for outdoor places: ten years of daily highs and
// precipitation from the Open-Meteo archive, reduced to half-month normals. A
// region is fetched once and kept in the crawl state; history does not change.

import type { Activity } from "../../src/core/activities.ts";
import { CLIMATE_POINTS, climateCell, climateNormals, type CellClimate, type DailyRow } from "../../src/core/climate.ts";
import type { CrawlState } from "./context.ts";
import type { Http } from "./http.ts";

const YEARS = 10;

interface ArchiveBody {
  elevation?: number;
  daily?: { time?: string[]; temperature_2m_max?: (number | null)[]; precipitation_sum?: (number | null)[] };
}

export function parseArchive(body: ArchiveBody): CellClimate | null {
  const d = body.daily;
  if (!d?.time?.length || typeof body.elevation !== "number") return null;
  const rows: DailyRow[] = d.time.map((date, i) => ({
    date,
    high: d.temperature_2m_max?.[i] ?? null,
    precipitationMm: d.precipitation_sum?.[i] ?? null,
  }));
  return climateNormals(rows, body.elevation);
}

/** Places that may be outdoors: everything not marked indoor, except dated offers. */
function wantsClimate(a: Activity): boolean {
  return a.setting !== "indoor" && !a.dates && a.lat !== undefined && a.lng !== undefined;
}

/** Climate of every region with an outdoor place, keyed by cell. */
export async function climateFor(
  http: Http,
  state: CrawlState,
  activities: readonly Activity[],
  now: Date,
  log: (msg: string) => void,
): Promise<Record<string, CellClimate>> {
  state.climate ??= {};
  const cells = new Set<string>();
  for (const a of activities) {
    if (wantsClimate(a)) cells.add(climateCell(a.lat!, a.lng!));
  }
  const lastYear = now.getFullYear() - 1;
  // Regions stored in an older format (monthly) are fetched again.
  const missing = [...cells].filter((c) => state.climate![c]?.high?.length !== CLIMATE_POINTS);
  if (missing.length) log(`climate: fetching ${missing.length} of ${cells.size} regions`);
  for (const cell of missing) {
    const [lat, lng] = cell.split(",");
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lng,
      start_date: `${lastYear - YEARS + 1}-01-01`,
      end_date: `${lastYear}-12-31`,
      daily: "temperature_2m_max,precipitation_sum",
      timezone: "Europe/Zurich",
    });
    try {
      const climate = parseArchive(await http.json<ArchiveBody>(`https://archive-api.open-meteo.com/v1/archive?${params}`));
      if (climate) state.climate[cell] = climate;
    } catch (e) {
      log(`climate: ${cell} failed: ${(e as Error).message}`);
    }
  }
  const ok = [...cells].filter((c) => state.climate![c]?.high?.length === CLIMATE_POINTS).sort();
  return Object.fromEntries(ok.map((c) => [c, state.climate![c]]));
}
