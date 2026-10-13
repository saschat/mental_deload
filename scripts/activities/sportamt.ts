// Sportamt Stadt Zürich holiday and semester courses. The course portal
// (stadt-zuerich.ch/sport-portal) is an Angular app over an undocumented JSON
// API: POST /api/courses with the search model, after picking up the
// antiforgery cookies. It may change without notice.

import type { Activity } from "../../src/core/activities.ts";
import type { Source } from "./context.ts";
import { compactDates } from "./text.ts";

const PORTAL = "https://www.stadt-zuerich.ch/sport-portal";
const API = `${PORTAL}/API`;

/** kurstyp in the search model. 1 (annual courses at single schools) is left out. */
const COURSE_TYPES = { 2: "Holiday course", 3: "Semester course" } as const;

export interface SportamtCourse {
  angebotId: number;
  titel: string;
  von: string;
  bis: string;
  kursOrt?: string;
  jahrgangVon?: number;
  jahrgangBis?: number;
  aktivitaet?: string;
  kurstypId: number;
  /** 1 = Monday … 7 = Sunday. */
  wochentage?: number[];
  /** "9.00–13.30 Uhr". */
  zeitpunkt3?: string;
  /** "Nicht mehr buchbar", "Nachmelden bis 30.06.2027" … */
  status1?: string;
  hatFreiePlaetze?: boolean;
  anlageBreitengrad?: number;
  anlageLaengengrad?: number;
  niveau?: string;
}

function clock(s: string): string {
  const [h, m = "00"] = s.split(/[.:]/);
  return `${h.padStart(2, "0")}:${m.padEnd(2, "0")}`;
}

/** "9.00–13.30 Uhr" → "09:00–13:30". */
export function courseTime(s: string | undefined): string | undefined {
  const m = /(\d{1,2}[.:]\d{2})\s*[–-]\s*(\d{1,2}[.:]\d{2})/.exec(s ?? "");
  return m ? `${clock(m[1])}–${clock(m[2])}` : undefined;
}

export function toActivity(c: SportamtCourse): Activity | null {
  const kind = COURSE_TYPES[c.kurstypId as keyof typeof COURSE_TYPES];
  if (!kind || !c.titel || !c.von) return null;
  const start = c.von.slice(0, 10);
  const end = (c.bis || c.von).slice(0, 10);
  const weekdays = c.kurstypId === 3 ? (c.wochentage ?? []).map((d) => d % 7) : undefined;
  const years = c.jahrgangVon && c.jahrgangBis && c.jahrgangVon > 1900 && c.jahrgangBis < 2400;
  const closed = /nicht mehr buchbar|ausgebucht/i.test(c.status1 ?? "") || c.hatFreiePlaetze === false;
  const activity: Activity = {
    id: `sportamt:${c.angebotId}`,
    source: "sportamt",
    title: c.titel.trim(),
    url: `${PORTAL}/angebot/${c.angebotId}`,
    kind,
    place: c.kursOrt?.trim() || undefined,
    lat: c.anlageBreitengrad || undefined,
    lng: c.anlageLaengengrad || undefined,
    birthYears: years ? [c.jahrgangVon!, c.jahrgangBis!] : undefined,
    dates: compactDates([{ start, end: end > start ? end : undefined, time: courseTime(c.zeitpunkt3) }]),
    weekdays: weekdays?.length ? weekdays : undefined,
    booking: closed ? "closed" : "required",
    tags: [c.aktivitaet, c.niveau].filter((t): t is string => !!t),
  };
  for (const k of Object.keys(activity) as (keyof Activity)[]) if (activity[k] === undefined) delete activity[k];
  return activity;
}

/** "name=value; Path=/" headers → "name=value; name2=value2". */
function cookieHeader(setCookies: string[], jar: Map<string, string>): string {
  for (const c of setCookies) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

export const sportamt: Source = {
  id: "sportamt",
  name: "Sportamt Stadt Zürich",
  url: `${PORTAL}/angebot/ferienkurse`,
  async run(ctx) {
    const jar = new Map<string, string>();
    for (const path of ["/api/lookups/init/ferientyp", "/api/accounts/currentuser"]) {
      const res = await ctx.http.request(`${API}${path}`, { headers: { Cookie: cookieHeader([], jar), Accept: "application/json" } }).catch(
        () => null,
      );
      if (res) cookieHeader(res.headers.getSetCookie(), jar);
      if (jar.has("XSRF-TOKEN")) break;
    }
    const token = jar.get("XSRF-TOKEN");
    if (!token) throw new Error("sport portal did not hand out an XSRF token");
    const out: Activity[] = [];
    for (const kurstyp of Object.keys(COURSE_TYPES).map(Number)) {
      const body = {
        keyword: null,
        kurstyp,
        aktivitaeten: [],
        ferienwochen: [],
        ferientyp: [],
        wochentage: [],
        jahrgaenge: [],
        geschlecht: null,
        kategorien: [],
        select1: [],
        select2: [],
        select3: [],
        check1: false,
        pageNumber: 0,
        pageSize: 2000,
        orderBy: null,
      };
      const res = await ctx.http.json<{ success?: boolean; data?: { results?: SportamtCourse[] } }>(`${API}/api/courses`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token, Cookie: cookieHeader([], jar) },
        body: JSON.stringify(body),
      });
      if (!res.success) throw new Error(`course search for kurstyp ${kurstyp} failed`);
      const courses = res.data?.results ?? [];
      for (const c of courses) {
        const a = toActivity(c);
        if (a) out.push(a);
      }
      ctx.log(`sportamt: kurstyp ${kurstyp}: ${courses.length} courses`);
    }
    return out;
  },
};
