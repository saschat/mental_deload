// Pro Juventute Ferienplausch Zürich: summer holiday activities on the
// OneGov "Feriennet" platform, which publishes them as JSON. Each activity
// carries every date it ever ran, so only the current period's year is kept.

import type { Activity } from "../../src/core/activities.ts";
import type { Source } from "./context.ts";
import { compactDates, slugOf } from "./text.ts";

const BASE = "https://ferienplausch.feriennet.projuventute.ch";

export interface FeriennetActivity {
  url: string;
  title: string;
  age?: { min?: number; max?: number };
  cost?: { min?: number; max?: number };
  spots?: number;
  dates?: { start_date: string; start_time?: string; end_date?: string; end_time?: string }[];
  location?: string;
  zip_code?: number;
  coordinate?: { lat?: number; lon?: number };
  tags?: string[];
}

export interface FeriennetExport {
  period_name?: string;
  booking_phase_start?: string;
  activities?: FeriennetActivity[];
}

const hm = (t: string | undefined) => t?.slice(0, 5);

/** "Pfingstweidstrasse 96\r\n8005 Zürich" → "Zürich". */
function town(location: string | undefined): string | undefined {
  const line = location?.split(/\r?\n/).find((l) => /^\s*\d{4}\s+\S/.test(l));
  return line?.replace(/^\s*\d{4}\s+/, "").trim() || undefined;
}

export function toActivities(body: FeriennetExport): Activity[] {
  const year = (body.booking_phase_start ?? "").slice(0, 4);
  const out: Activity[] = [];
  for (const a of body.activities ?? []) {
    const dates = compactDates(
      (a.dates ?? [])
        .filter((d) => !year || d.start_date.startsWith(year))
        .map((d) => {
          const time = d.start_time && d.end_time ? `${hm(d.start_time)}–${hm(d.end_time)}` : undefined;
          const end = d.end_date && d.end_date > d.start_date ? d.end_date : undefined;
          return { start: d.start_date, end, time };
        }),
    );
    if (!dates.length || !a.title || !a.url) continue;
    const activity: Activity = {
      id: `ferienplausch:${slugOf(a.url)}`,
      source: "ferienplausch",
      title: a.title.replace(/^\d+\.\s*/, "").trim(),
      url: a.url,
      kind: "Holiday course",
      lat: a.coordinate?.lat || undefined,
      lng: a.coordinate?.lon || undefined,
      place: town(a.location),
      ageMin: a.age?.min,
      ageMax: a.age?.max,
      costChf: a.cost?.min,
      dates,
      booking: a.spots === 0 ? "closed" : "required",
      tags: a.tags?.slice(0, 6),
    };
    for (const k of Object.keys(activity) as (keyof Activity)[]) if (activity[k] === undefined) delete activity[k];
    out.push(activity);
  }
  return out;
}

export const ferienplausch: Source = {
  id: "ferienplausch",
  name: "Pro Juventute Ferienplausch",
  url: BASE,
  async run(ctx) {
    const body = await ctx.http.json<FeriennetExport>(`${BASE}/activities/json`);
    const out = toActivities(body);
    ctx.log(`ferienplausch: ${body.period_name ?? "?"}: ${out.length} activities`);
    return out;
  },
};
