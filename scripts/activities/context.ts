// What every source gets: polite HTTP, the previous index and crawl state for
// incremental runs, geocoding, and a logger.

import type { Activity, ActivitySourceId } from "../../src/core/activities.ts";
import type { Http } from "./http.ts";

export interface PageState {
  /** Sitemap lastmod (or other change marker) when the page was fetched. */
  lastmod?: string;
  fetchedAt: string;
  /** Activities the page produced; empty for pages that are not activities. */
  ids: string[];
  /** Parser version that read the page (the source module's VERSION). */
  v?: number;
}

export interface CrawlState {
  v: 1;
  pages: Record<string, PageState>;
  /** Query → [lat, lng], or null when geo.admin.ch found nothing. */
  geocode: Record<string, [number, number] | null>;
  /** "lat,lng" rounded to 4 decimals → metres. */
  elevation: Record<string, number>;
}

export function emptyState(): CrawlState {
  return { v: 1, pages: {}, geocode: {}, elevation: {} };
}

export interface Context {
  http: Http;
  state: CrawlState;
  previous: Map<string, Activity>;
  now: Date;
  /** Development limit on detail pages fetched per source. */
  maxPages: number;
  log: (msg: string) => void;
  geocode: (query: string) => Promise<[number, number] | null>;
}

export interface Source {
  id: ActivitySourceId;
  name: string;
  url: string;
  run: (ctx: Context) => Promise<Activity[]>;
  /** Display name of a feed (Activity.feed), e.g. "gz-witikon" → "GZ Witikon". */
  feedName?: (feed: string) => string;
}

/**
 * Re-fetch a page when its lastmod changed, the copy is older than
 * `maxAgeDays`, or an older parser version read it. Bump a source's version
 * whenever its parser learns to read something new.
 */
export function isFresh(
  page: PageState | undefined,
  lastmod: string | undefined,
  now: Date,
  maxAgeDays: number,
  version: number,
): boolean {
  if (!page || (page.v ?? 1) !== version) return false;
  if (lastmod && page.lastmod !== lastmod) return false;
  return now.getTime() - Date.parse(page.fetchedAt) < maxAgeDays * 86_400_000;
}

/** Previous activities for a page, or null if any of them went missing. */
export function reuse(ctx: Context, page: PageState): Activity[] | null {
  const out: Activity[] = [];
  for (const id of page.ids) {
    const a = ctx.previous.get(id);
    if (!a) return null;
    out.push(a);
  }
  return out;
}

export function remember(ctx: Context, url: string, lastmod: string | undefined, activities: Activity[], version: number) {
  ctx.state.pages[url] = { lastmod, fetchedAt: ctx.now.toISOString(), ids: activities.map((a) => a.id), v: version };
}

/** URLs and lastmod dates from a sitemap or sitemap index. */
export function parseSitemap(xml: string): { loc: string; lastmod?: string }[] {
  const out: { loc: string; lastmod?: string }[] = [];
  for (const m of xml.matchAll(/<(?:url|sitemap)>([\s\S]*?)<\/(?:url|sitemap)>/g)) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(m[1])?.[1];
    const lastmod = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/.exec(m[1])?.[1];
    if (loc) out.push({ loc: loc.replace(/&amp;/g, "&"), lastmod });
  }
  return out;
}
