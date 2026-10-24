// MySwitzerland (Switzerland Tourism): the open data API (CC BY-SA) lists
// attractions with coordinates, a link to myswitzerland.com and
// classifications: suitable for families or children, children's ages,
// seasons, indoor/outdoor. It needs a free key (developer.myswitzerland.io) in
// MYSWITZERLAND_API_KEY, e.g. in the gitignored .env; without one the source
// fails and the previous entries are kept. The key allows 1000 requests a day;
// a run takes about a dozen.

import type { Activity, Setting } from "../../src/core/activities.ts";
import { distanceKm, ZURICH_HB } from "../../src/core/geo.ts";
import type { Context, Source } from "./context.ts";
import { inlineText } from "./text.ts";

const BASE = "https://opendata.myswitzerland.io/v1";
/** The API's own distance filter lets places much further out through. */
const MAX_KM = 80;
/** The API's largest page. */
const PAGE_SIZE = 50;

interface Classification {
  name: string;
  values: { name: string; title?: string }[];
}

export interface MsAttraction {
  identifier: string;
  name: string;
  url?: string;
  geo?: { latitude: number; longitude: number };
  classification?: Classification[];
}

interface Page {
  meta?: { page?: { totalPages?: number } };
  data?: MsAttraction[];
}

function values(a: MsAttraction, name: string): string[] {
  return a.classification?.find((c) => c.name === name)?.values.map((v) => v.name) ?? [];
}

/** Kinds by the attraction's name and classifications, first match wins. */
const KINDS: [(a: MsAttraction, has: (c: string) => boolean) => boolean, string][] = [
  [(a) => /schlitt/i.test(a.name), "Sledding"],
  [(a, has) => has("sporttype.toboggan") || /rodel|bobbahn|solarbob|zipline|seilpark|kletterpark/i.test(a.name) || has("naturetype.ropepark"), "Adventure park"],
  [(a) => /klettersteig/i.test(a.name), "Climbing"],
  [(a) => /freizeitpark|erlebnispark|kids arena|abenteuerpark|conny-land/i.test(a.name), "Theme park"],
  [(a, has) => has("funandadventureforkids.playground") || /spielplatz/i.test(a.name), "Playground"],
  [(a) => /zoo|tierpark|wildpark|sea life|eselhof|fischotter|vogelwarte|alpöhi/i.test(a.name), "Animals"],
  [(a, has) => has("sporttype.bathingandswimming") || /bad\b|bäder|aquabasilea|badeinsel|säntispark/i.test(a.name), "Swimming"],
  [(a, has) => has("museumtype") || /museum|galerie/i.test(a.name), "Museum"],
  [(a, has) => has("achitekturtyp") || /schloss|ruine|burg\b|festung/i.test(a.name), "Castle"],
  [(a, has) => has("transporttype.ship") || /schifffahrt|fähre/i.test(a.name), "Trip"],
  [(a, has) => has("transporttype.cablerailway") || has("transporttype.train") || /bahn\b|seilbahn|schwebebahn/i.test(a.name), "Mountain"],
  [(a, has) => has("naturetrailtype") || /weg\b|pfad|trail|parcours|rundweg/i.test(a.name), "Hike"],
  [(a, has) => has("naturetype") || has("experiencetype.nature"), "Nature"],
  [(a, has) => has("experiencetype.urban"), "Trip"],
];

/** Kinds whose season is a real opening season. */
const SEASONAL_KINDS = new Set(["Swimming", "Adventure park", "Theme park", "Sledding"]);

const AGE_BANDS: Record<string, [number, number | undefined]> = {
  "0to5years": [0, 5],
  "6to9years": [6, 9],
  "10to13years": [10, 13],
  "14plus": [14, undefined],
};
/**
 * Months from the seasons it is recommended for. These read like best times
 * ("winter and summer" for a tower), so only clear cases count: winter only is
 * a snow outing, no winter at all a warm-season one.
 */
export function seasonMonths(seasons: readonly string[]): number[] | undefined {
  const s = new Set(seasons.filter((v) => ["spring", "summer", "autumn", "winter"].includes(v)));
  if (s.size === 1 && s.has("winter")) return [12, 1, 2, 3];
  if (s.size && !s.has("winter") && s.has("summer")) return [4, 5, 6, 7, 8, 9, 10];
  return undefined;
}

/** Activity for an attraction, or null when it is not for families or too far. */
export function toActivity(a: MsAttraction): Activity | null {
  const lat = a.geo?.latitude;
  const lng = a.geo?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number" || distanceKm({ lat, lng }, ZURICH_HB) > MAX_KM) return null;
  const ages = values(a, "childrenage").filter((v) => v in AGE_BANDS);
  const forFamilies = values(a, "suitablefortype").some((v) => v === "family" || v === "children");
  if (!forFamilies && !ages.length) return null;
  // Teenagers only, or a spa.
  if ((ages.length && ages.every((v) => v === "14plus")) || /wellness|therme|\bspa\b/i.test(a.name)) return null;
  const names = new Set((a.classification ?? []).flatMap((c) => [c.name, ...c.values.map((v) => `${c.name}.${v.name}`)]));
  const has = (c: string) => names.has(c);
  const title = inlineText(a.name);
  const kind = KINDS.find(([test]) => test({ ...a, name: title }, has))?.[1] ?? "Outing";
  const where = values(a, "indooroutdoorclassifications");
  const setting: Setting | undefined = where.includes("indooroutdoor")
    ? "mixed"
    : where.includes("indoor") && where.includes("outdoor")
      ? "mixed"
      : where.includes("indoor")
        ? "indoor"
        : where.includes("outdoor")
          ? "outdoor"
          : undefined;
  // Zoos, towers and boats open all year are often recommended for the warm seasons only.
  const seasonal = SEASONAL_KINDS.has(kind) && !(kind === "Swimming" && setting !== "outdoor");
  const months = seasonal ? seasonMonths(values(a, "seasons")) : undefined;
  const bands = ages.map((v) => AGE_BANDS[v]);
  const ageMin = bands.length ? Math.min(...bands.map(([min]) => min)) : undefined;
  const ageMax = bands.length && bands.every(([, max]) => max !== undefined) ? Math.max(...bands.map(([, max]) => max!)) : undefined;
  const activity: Activity = {
    id: `myswitzerland:${a.identifier}`,
    source: "myswitzerland",
    title,
    url: a.url ?? `https://www.myswitzerland.com/de/`,
    kind,
    setting,
    lat,
    lng,
    months,
    ageMin: ageMin || undefined,
    ageMax,
    tags: values(a, "experiencetype"),
  };
  for (const k of Object.keys(activity) as (keyof Activity)[]) if (activity[k] === undefined) delete activity[k];
  if (!activity.tags?.length) delete activity.tags;
  return activity;
}

export const myswitzerland: Source = {
  id: "myswitzerland",
  name: "MySwitzerland",
  url: "https://www.myswitzerland.com",
  async run(ctx: Context) {
    const key = process.env.MYSWITZERLAND_API_KEY;
    if (!key) throw new Error("MYSWITZERLAND_API_KEY is not set (see README)");
    const headers = { "x-api-key": key };
    const [lat, lng] = [ZURICH_HB.lat.toFixed(3), ZURICH_HB.lng.toFixed(3)];
    const out: Activity[] = [];
    let seen = 0;
    for (let page = 0, pages = 1; page < pages && page < 40; page++) {
      const url = `${BASE}/attractions?lang=de&hitsPerPage=${PAGE_SIZE}&page=${page}&geo.dist=${lat},${lng},${MAX_KM * 1000}`;
      const body = await ctx.http.json<Page>(url, { headers });
      pages = body.meta?.page?.totalPages ?? 0;
      for (const a of body.data ?? []) {
        seen += 1;
        const activity = toActivity(a);
        if (activity) out.push(activity);
      }
    }
    ctx.log(`myswitzerland: ${seen} attractions, ${out.length} for families within ${MAX_KM} km`);
    return out;
  },
};
