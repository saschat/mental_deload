// swissfamilyfun.com: family outings across Switzerland. Its REST API is
// blocked, but the sitemap is open and every single-outing post has a fact
// table (Location, Car, Train, Trail, Elevation, Condition, Skill, Open,
// Cost). Round-ups and guides have no table and are skipped.

import type { Activity, Setting } from "../../src/core/activities.ts";
import { isFresh, parseSitemap, remember, reuse, type Context, type Source } from "./context.ts";
import { parseCoordinates } from "./geo.ts";
import {
  decodeEntities,
  htmlToText,
  inlineText,
  parseAges,
  parseChf,
  parseElevation,
  parseMonths,
  parseSuitableAge,
  parseTrail,
  parseTravelMinutes,
  slugOf,
} from "./text.ts";

const BASE = "https://swissfamilyfun.com";
/** Posts rarely change; re-read unchanged ones every quarter anyway. */
const MAX_AGE_DAYS = 90;
/** 2: target ages. */
const VERSION = 2;

export interface SffPost {
  title: string;
  facts: Record<string, string>;
  /** Raw HTML of the fact table, for coordinates. */
  factsHtml: string;
  sections: string[];
  keywords: string[];
  embedPlace?: string;
  /** Article text without reader comments, for age recommendations. */
  text: string;
}

export function parsePost(html: string): SffPost {
  const ld = /<script type="application\/ld\+json" class="yoast-schema-graph">([\s\S]*?)<\/script>/.exec(html);
  let title = "";
  let sections: string[] = [];
  let keywords: string[] = [];
  if (ld) {
    try {
      const graph = (JSON.parse(ld[1]) as { "@graph"?: Record<string, unknown>[] })["@graph"] ?? [];
      const article = graph.find((n) => n["@type"] === "Article" || n["@type"] === "BlogPosting");
      if (article) {
        title = decodeEntities(String(article.headline ?? ""));
        sections = ((article.articleSection as string[]) ?? []).map(decodeEntities);
        keywords = ((article.keywords as string[]) ?? []).map(decodeEntities);
      }
    } catch {
      // Fall back to <title> below.
    }
  }
  if (!title) title = inlineText(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? "").replace(/\s*[|–-]\s*Swiss Family Fun\s*$/i, "");

  const facts: Record<string, string> = {};
  let factsHtml = "";
  for (const table of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const rows = [...table[0].matchAll(/<tr[^>]*>\s*<t[dh][^>]*>([\s\S]*?)<\/t[dh]>\s*<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)];
    const parsed = rows.map(([, k, v]) => [inlineText(k).replace(/:$/, "").trim(), inlineText(v)] as const).filter(([k]) => k);
    // The fact table is the one that says where and how to get there.
    if (!parsed.some(([k]) => /location|address|region|car|train|transport|trail/i.test(k))) continue;
    for (const [k, v] of parsed) facts[k] = v;
    factsHtml = table[0];
    break;
  }
  const embed = /google\.com\/maps\/embed\?pb=[^"']*?!2s([^!"']+)/.exec(html);
  const embedPlace = embed ? decodeURIComponent(embed[1].replace(/\+/g, " ")) : undefined;
  // Reader comments ("my 7 year old loved it") are not recommendations.
  const start = html.search(/<h1[\s>]/);
  const end = html.search(/id="comments"|class="comments-area|Leave a Reply/);
  const text = htmlToText(html.slice(Math.max(0, start), end > start ? end : undefined));
  return { title, facts, factsHtml, sections, keywords, embedPlace, text };
}

function fact(facts: Record<string, string>, re: RegExp): string | undefined {
  const key = Object.keys(facts).find((k) => re.test(k));
  return key ? facts[key] : undefined;
}

/** Every matching fact, joined, for hints that may sit in any of them. */
function allFacts(facts: Record<string, string>, re: RegExp): string {
  return Object.keys(facts)
    .filter((k) => re.test(k))
    .map((k) => facts[k])
    .join(" · ");
}

const KINDS: [RegExp, string, Setting | undefined][] = [
  [/indoor|play ?(centre|center|area)|trampolin/i, "Indoor play", "indoor"],
  [/museum|exhibit|science/i, "Museum", "indoor"],
  [/sled|toboggan/i, "Sledding", "outdoor"],
  [/\bski|snowshoe|winter hike|winter walk/i, "Snow", "outdoor"],
  [/skat|ice rink/i, "Ice skating", "mixed"],
  [/hik|trail|walk|wander|path/i, "Hike", "outdoor"],
  [/playground|spielplatz/i, "Playground", "outdoor"],
  [/zoo|animal|wildlife|tierpark|farm/i, "Animals", "outdoor"],
  [/swim|pool|bath|beach|badi|lido/i, "Swimming", "outdoor"],
  [/bik|cycl|pump ?track/i, "Biking", "outdoor"],
  [/boat|cruise|ship|raft|canoe|kayak|sup\b/i, "Water", "outdoor"],
  [/castle|ruin|burg/i, "Castle", "mixed"],
  [/camp/i, "Camping", "outdoor"],
  [/theme park|amusement|adventure park|rope park|climbing/i, "Adventure park", "outdoor"],
  [/cable car|gondola|mountain|summit|lookout|tower|view/i, "Mountain", "outdoor"],
  [/cave|gorge|waterfall|lake|river|nature/i, "Nature", "outdoor"],
  [/chocolate|cheese|factory|workshop/i, "Factory visit", "indoor"],
];

export function classify(post: Pick<SffPost, "title" | "sections" | "keywords">): { kind: string; setting?: Setting } {
  const text = [...post.sections, post.title].join(" · ");
  const rainy = post.keywords.some((k) => /rainy/i.test(k));
  for (const [re, kind, setting] of KINDS) {
    if (re.test(text)) return { kind, setting: rainy && setting === "outdoor" ? "mixed" : setting };
  }
  return { kind: "Outing", setting: rainy ? "indoor" : undefined };
}

export function strollerFrom(...texts: (string | undefined)[]): boolean | undefined {
  const t = texts.filter(Boolean).join(" ").toLowerCase();
  if (/no strollers?|not (?:suitable|good|possible|recommended) for (?:a )?strollers?|not stroller|strollers? (?:not|aren.t|are not)/.test(t)) return false;
  if (/stroller[- ](?:friendly|accessible|ok)|strollers? (?:ok|fine|possible|friendly)|suitable for strollers?|good for strollers?|with (?:a )?stroller|wheelchair (?:and|&) stroller|stroller accessible/.test(t)) {
    return true;
  }
  return undefined;
}

/** Activity from a parsed post, or null for posts that are not a single outing. */
export function toActivity(url: string, post: SffPost): Omit<Activity, "lat" | "lng"> | null {
  const f = post.facts;
  if (Object.keys(f).length < 3) return null;
  const { kind, setting } = classify(post);
  const trail = fact(f, /^trail|^route|^hike|^walk|distance/i);
  const elevation = parseElevation(fact(f, /elevation|altitude|height/i));
  const hike = parseTrail(trail);
  if (elevation.upM !== undefined) hike.upM = elevation.upM;
  if (elevation.downM !== undefined) hike.downM = elevation.downM;
  const skill = fact(f, /^skill|difficulty/i);
  if (skill) hike.skill = skill.split(/[,(]/)[0].trim().slice(0, 30);
  const winter = /sled|ski|snow|winter/i.test([...post.sections, post.title].join(" "));
  const months = parseMonths(fact(f, /^open|season|when/i)) ?? (winter ? [12, 1, 2, 3] : undefined);
  const place = (fact(f, /^location|^region/i) ?? "").split(/[,•]/)[0].trim() || undefined;
  const ageFact = fact(f, /^ages?\b|^kids|^children|^suitable/i);
  const ages = ageFact ? parseAges(ageFact) : parseSuitableAge(post.text);
  const activity: Omit<Activity, "lat" | "lng"> = {
    id: `swissfamilyfun:${slugOf(url)}`,
    source: "swissfamilyfun",
    title: post.title,
    url,
    kind,
    setting,
    place,
    carMin: parseTravelMinutes(fact(f, /car|driv|parking/i)),
    transitMin: parseTravelMinutes(fact(f, /train|transit|public|transport|bus/i)),
    altitudeM: elevation.maxM,
    hike: Object.keys(hike).length ? hike : undefined,
    stroller: strollerFrom(allFacts(f, /condition|surface|trail|services|access/i)),
    months,
    ageMin: ages.min,
    ageMax: ages.max,
    costChf: parseChf(fact(f, /cost|price|ticket|fee/i)),
    tags: [...new Set([...post.sections, ...post.keywords])].slice(0, 6),
  };
  for (const k of Object.keys(activity) as (keyof typeof activity)[]) if (activity[k] === undefined) delete activity[k];
  return activity;
}

export async function locate(ctx: Context, post: SffPost, html: string): Promise<[number, number] | null> {
  const direct = parseCoordinates(post.factsHtml);
  if (direct) return direct;
  const lookup = async (q: string | undefined) => {
    if (!q) return null;
    const cleaned = q.replace(/^(parking|start|end|bus stop|train station)\s*:\s*/i, "").split(/\s\/\s/)[0].slice(0, 120);
    return ctx.geocode(cleaned);
  };
  // The address beats links elsewhere on the page, which may point at other posts' places.
  return (
    (await lookup(fact(post.facts, /address|parking|start/i))) ??
    parseCoordinates(html) ??
    (await lookup(post.embedPlace)) ??
    (await lookup(post.title.split(/[•:|–-]/)[0]))
  );
}

export const swissfamilyfun: Source = {
  id: "swissfamilyfun",
  name: "Swiss Family Fun",
  url: BASE,
  async run(ctx) {
    const index = parseSitemap(await ctx.http.text(`${BASE}/sitemap_index.xml`));
    const posts = [];
    for (const sm of index.filter((s) => /\/post-sitemap\d*\.xml$/.test(s.loc))) {
      posts.push(...parseSitemap(await ctx.http.text(sm.loc)));
    }
    // German posts translate English ones; keep one language.
    const english = posts.filter((p) => !/swissfamilyfun\.com\/(de|fr)\//.test(p.loc));
    ctx.log(`swissfamilyfun: ${english.length} posts in sitemap`);
    const out: Activity[] = [];
    let fetched = 0;
    for (const { loc, lastmod } of english) {
      const page = ctx.state.pages[loc];
      if (isFresh(page, lastmod, ctx.now, MAX_AGE_DAYS, VERSION)) {
        const kept = reuse(ctx, page!);
        if (kept) {
          out.push(...kept);
          continue;
        }
      }
      if (fetched >= ctx.maxPages) continue;
      fetched += 1;
      let html: string;
      try {
        html = await ctx.http.text(loc);
      } catch (e) {
        ctx.log(`swissfamilyfun: ${(e as Error).message}`);
        const kept = page ? reuse(ctx, page) : null;
        if (kept) out.push(...kept);
        continue;
      }
      const post = parsePost(html);
      const base = toActivity(loc, post);
      if (!base) {
        remember(ctx, loc, lastmod, [], VERSION);
        continue;
      }
      const at = await locate(ctx, post, html);
      const activity: Activity = at ? { ...base, lat: at[0], lng: at[1] } : base;
      remember(ctx, loc, lastmod, [activity], VERSION);
      out.push(activity);
      if (fetched % 50 === 0) ctx.log(`swissfamilyfun: fetched ${fetched} posts`);
    }
    ctx.log(`swissfamilyfun: fetched ${fetched}, ${out.length} activities`);
    return out;
  },
};
