// Builds public/activities.json (the index the app reads, committed) and
// .cache/activities-state.json (crawl state for the next incremental run,
// local only).
//
//   node scripts/activities/build.ts [--only=gz,osm] [--max-pages=20] [--out=public] [--state=.cache/activities-state.json]
//
// A source that fails keeps its entries from the previous index, so one site
// being down never empties the app.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Activity, ActivityIndex, ActivitySourceId, ActivitySourceInfo } from "../../src/core/activities.ts";
import { categorize, settingFromText } from "../../src/core/categories.ts";
import { climateFor } from "./climate.ts";
import { emptyState, type Context, type CrawlState, type Source } from "./context.ts";
import { familienausflug } from "./familienausflug.ts";
import { ferienplausch } from "./ferienplausch.ts";
import { enrich, makeGeocoder } from "./geo.ts";
import { gz } from "./gz.ts";
import { Http } from "./http.ts";
import { osm } from "./osm.ts";
import { sportamt } from "./sportamt.ts";
import { swissfamilyfun } from "./swissfamilyfun.ts";

const SOURCES: Source[] = [swissfamilyfun, familienausflug, osm, gz, sportamt, ferienplausch];

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Drop dates that ended before today, and offers left without any. */
function prune(activities: Activity[], today: string): Activity[] {
  const out: Activity[] = [];
  for (const a of activities) {
    if (!a.dates) {
      out.push(a);
      continue;
    }
    const dates = a.dates.filter((d) => (d.end ?? d.start) >= today);
    if (dates.length) out.push({ ...a, dates });
  }
  return out;
}

async function main() {
  const outDir = arg("out") ?? "public";
  const only = arg("only")?.split(",") as ActivitySourceId[] | undefined;
  const maxPages = Number(arg("max-pages") ?? Infinity);
  const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

  const indexPath = join(outDir, "activities.json");
  const statePath = arg("state") ?? join(".cache", "activities-state.json");
  const previousIndex = readJson<ActivityIndex>(indexPath);
  const state = readJson<CrawlState>(statePath) ?? emptyState();
  const previous = new Map((previousIndex?.activities ?? []).map((a) => [a.id, a]));
  log(`previous index: ${previous.size} activities, ${Object.keys(state.pages).length} known pages`);

  const http = new Http({
    // robots.txt crawl delays.
    delayMs: {
      "ferienplausch.feriennet.projuventute.ch": 10_000,
      "api3.geo.admin.ch": 250,
      "api.open-meteo.com": 250,
      // Ten years of history is a heavy request; Open-Meteo answers 429 when they come faster.
      "archive-api.open-meteo.com": 8000,
    },
    log,
  });
  const now = new Date();
  const ctx: Context = { http, state, previous, now, maxPages, log, geocode: makeGeocoder(http, state) };

  const selected = SOURCES.filter((s) => !only || only.includes(s.id));
  const results = await Promise.allSettled(selected.map((s) => s.run(ctx)));

  const infos: ActivitySourceInfo[] = [];
  const activities: Activity[] = [];
  for (const source of SOURCES) {
    const i = selected.indexOf(source);
    const before = previousIndex?.sources.find((s) => s.id === source.id);
    const kept = [...previous.values()].filter((a) => a.source === source.id);
    const result = i === -1 ? null : results[i];
    if (result?.status === "fulfilled") {
      activities.push(...result.value);
      infos.push({ id: source.id, name: source.name, url: source.url, count: result.value.length, fetchedAt: now.toISOString() });
    } else {
      // Not selected or failed: keep what the last run had.
      activities.push(...kept);
      const error = result?.status === "rejected" ? String((result.reason as Error)?.message ?? result.reason) : before?.error;
      if (result?.status === "rejected") log(`${source.id} FAILED, kept ${kept.length} previous entries: ${error}`);
      infos.push({ id: source.id, name: source.name, url: source.url, count: kept.length, fetchedAt: before?.fetchedAt, error });
    }
  }

  const unique = [...new Map(activities.map((a) => [a.id, a])).values()];
  await enrich(http, state, unique, log);
  const today = now.toISOString().slice(0, 10);
  const final = prune(unique, today).sort((a, b) => a.id.localeCompare(b.id));
  // Categories and indoor/outdoor are derived from the stored facts, so rule changes apply to cached entries too.
  for (const a of final) {
    a.category = categorize(a);
    a.setting = settingFromText(a);
    if (!a.setting) delete a.setting;
  }
  for (const info of infos) {
    const mine = final.filter((a) => a.source === info.id);
    info.count = mine.length;
    const feeds = new Map<string, number>();
    for (const a of mine) if (a.feed) feeds.set(a.feed, (feeds.get(a.feed) ?? 0) + 1);
    const source = SOURCES.find((s) => s.id === info.id);
    if (feeds.size) {
      info.feeds = [...feeds]
        .map(([id, count]) => ({ id, name: source?.feedName?.(id) ?? id, count }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  const climate = await climateFor(http, state, final, now, log);
  const index: ActivityIndex = { v: 1, generatedAt: now.toISOString(), sources: infos, climate, activities: final };
  mkdirSync(outDir, { recursive: true });
  // One activity per line keeps the diff of a committed refresh readable.
  const lines = index.activities.map((a) => `    ${JSON.stringify(a)}`).join(",\n");
  const head = JSON.stringify({ ...index, activities: [] }).replace(/"activities":\[\]\}$/, "");
  writeFileSync(indexPath, `${head}\n  "activities": [\n${lines}\n  ]\n}\n`);
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state));
  log(`wrote ${final.length} activities to ${indexPath} (${http.requests} requests)`);
  for (const info of infos) log(`  ${info.id}: ${info.count}${info.error ? ` (error: ${info.error})` : ""}`);
  if (infos.every((i) => i.error) && selected.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
