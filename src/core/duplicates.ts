/**
 * The same place or event listed by several sources: "Juckerhof Seegräben",
 * "Jucker Farm" and "Erlebnishof Juckerhof". The indexer marks every listing
 * but one with `duplicateOf` (see findDuplicates); the app shows them as one
 * entry (see mergeDuplicates). Kept free of imports so the indexer (plain Node)
 * can run it.
 *
 * Titles are compared by their words, weighted by how rare each word is
 * across the index: a shared "Jucker" or "Höllgrotten" says much, a shared
 * "Museum" or "Zürich" little. Only listings close to each other are compared,
 * and the closer they are, the less their titles need to agree.
 */

export interface Listing {
  id: string;
  source: string;
  title: string;
  place?: string;
  lat?: number;
  lng?: number;
  months?: number[];
  dates?: { start: string; end?: string }[];
  duplicateOf?: string;
}

/** Which listing of a group is shown: the first source here. Unlisted sources come last. */
export const SOURCE_RANK = [
  "swissfamilyfun",
  "familienausflug",
  "zuerich",
  "myswitzerland",
  "kikuka",
  "gz",
  "freizeit",
  "zuerioberland",
  "sportamt",
  "ferienplausch",
  "osm",
];

/** Farthest apart two listings of one place can be: sources geocode a park or a cave entrance differently. */
const MAX_KM = 2;
/** Within this, a lower title score is enough. */
const NEAR_KM = 0.3;
const NEAR_SCORE = 0.5;
const FAR_SCORE = 0.75;
/** Words that do not tell places apart, in the languages the sources write in. */
const STOPWORDS = new Set(
  "der die das den dem des ein eine und oder in im am an auf bei beim von vom zu zum zur mit fur fuer uber the a an of at in on and to for with near by la le les de du et".split(" "),
);
/** Shortest word that counts as the start or end of a compound: "Saurier" in "Sauriermuseum". */
const MIN_PART = 5;
/**
 * Town and lake names say where a place is, which the distance already
 * covers: "Kilchberg" in "Lindt Chocolateria in Kilchberg" and "Strandbad
 * Kilchberg" does not make them one.
 */
const PLACE_FACTOR = 0.25;
/** Sources whose `place` is the town; the others give a venue ("Kids Arena", "Landesmuseum"). */
const TOWN_SOURCES = new Set(["familienausflug", "freizeit", "osm", "zuerich", "zuerioberland"]);
/** English words as the German sources write them, so "Jucker Farm" meets "Juckerhof" and "Dinosaur Museum" "Sauriermuseum". */
const ALIASES: Record<string, string> = {
  zurich: "zuerich",
  lucerne: "luzern",
  farm: "hof",
  castle: "schloss",
  dinosaur: "saurier",
  children: "kinder",
  playground: "spielplatz",
  waterfall: "wasserfall",
  gorge: "schlucht",
  glass: "glas",
  toboggan: "rodel",
};
/** A word in at most this many titles names something on its own. */
const DISTINCT_TITLES = 8;
/** Share of the longer title its words must cover as well, so "Strandbad Uster" is not "Uster". */
const MIN_COVER = 0.5;

/** "Höllgrotten Baar – Tropfsteinhöhle" → ["hoellgrotten", "baar", "tropfsteinhoehle"]. */
export function words(title: string): string[] {
  const folded = title
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const out = (folded.match(/[a-z0-9]+/g) ?? []).filter((w) => !STOPWORDS.has(w) && !/^\d{1,2}$/.test(w)).map((w) => ALIASES[w] ?? w);
  return [...new Set(out)];
}

/** The name before a subtitle: "Technorama Winterthur – Das einzige Science Center" → "Technorama Winterthur". */
export function mainTitle(title: string): string {
  return title.split(/\s[–—•|]\s|:\s/)[0];
}

/** "Pfäffikersee", "Zugersee". */
const isLake = (w: string) => /.{4}see$/.test(w);

export interface Weights {
  (word: string): number;
  /** Whether a word names something on its own: rare and not a town or lake. */
  distinct(word: string): boolean;
  place(word: string): boolean;
}

/**
 * How much each word tells listings apart: inverse document frequency over
 * the titles, so rare words weigh more, and less for town and lake names.
 */
export function wordWeights(listings: readonly { source: string; title: string; place?: string }[]): Weights {
  const df = new Map<string, number>();
  for (const l of listings) for (const w of words(l.title)) df.set(w, (df.get(w) ?? 0) + 1);
  const places = new Set(listings.flatMap((l) => (l.place && TOWN_SOURCES.has(l.source) ? words(l.place) : [])));
  const n = listings.length + 1;
  const isPlace = (w: string) => places.has(w) || isLake(w);
  const weight = (w: string) => Math.log(n / (df.get(w) ?? 1)) * (isPlace(w) ? PLACE_FACTOR : 1);
  return Object.assign(weight, { distinct: (w: string) => !isPlace(w) && (df.get(w) ?? 0) <= DISTINCT_TITLES, place: isPlace });
}

/**
 * What `w` earns from the other title: its full weight for the same word or
 * two words written together ("Jucker Farm" for "Juckerfarm"), and for a
 * compound part ("Jucker" in "Juckerhof") the part's weight, less the
 * smaller a share of the compound it is, so "Advent" adds little to
 * "Adventskranzbinden".
 */
function credit(w: string, other: readonly string[], weight: Weights, joined: ReadonlySet<string> = new Set()): number {
  if (joined.has(w)) return weight(w);
  let best = 0;
  for (let i = 0; i < other.length; i++) {
    const o = other[i];
    if (o === w || (i + 1 < other.length && o + other[i + 1] === w)) return weight(w);
    const [short, long] = o.length < w.length ? [o, w] : [w, o];
    if (short.length >= MIN_PART && (long.startsWith(short) || long.endsWith(short))) {
      best = Math.max(best, Math.min(weight(short), weight(w)) * Math.sqrt(short.length / long.length));
    }
  }
  return best;
}

/**
 * How well two titles agree, 0–1: the share of the shorter title's weight
 * that the other title has, so a title with a subtitle still matches its
 * plain name. The longer one must be covered by MIN_COVER too, or the score is
 * 0, as it is when each has a distinct word the other lacks. Each side is
 * also compared without its subtitle.
 */
export function titleScore(a: string, b: string, weight: Weights): number {
  // Two words the other title writes as one ("Jucker Hof", "Juckerhof") both count.
  const joined = (x: string[], y: string[]) => {
    const out = new Set<string>();
    for (let i = 0; i + 1 < x.length; i++) if (y.includes(x[i] + x[i + 1])) out.add(x[i]).add(x[i + 1]);
    return out;
  };
  const share = (x: string[], y: string[]) => {
    const total = x.reduce((s, w) => s + weight(w), 0);
    const j = joined(x, y);
    return total ? x.reduce((s, w) => s + credit(w, y, weight, j), 0) / total : 0;
  };
  let best = 0;
  for (const x of [words(a), words(mainTitle(a))]) {
    for (const y of [words(b), words(mainTitle(b))]) {
      const sx = share(x, y);
      const sy = share(y, x);
      const lacks = (from: string[], to: string[], test: (w: string) => boolean) => {
        const j = joined(from, to);
        return from.some((w) => test(w) && !credit(w, to, weight, j));
      };
      // Each names something the other lacks ("Wildnispark Zürich Sihlwald", "… Langenberg") or another lake; two towns alone may be neighbours.
      const named = (w: string) => weight.distinct(w) || weight.place(w);
      const conflict =
        (lacks(x, y, weight.distinct) && lacks(y, x, named)) ||
        (lacks(y, x, weight.distinct) && lacks(x, y, named)) ||
        (lacks(x, y, isLake) && lacks(y, x, isLake));
      // Sharing only a lake or town name: "Pfäffikersee" is the lake, not "Museum am Pfäffikersee".
      const placesOnly = !x.some((w) => !weight.place(w) && credit(w, y, weight));
      const cover = Math.min(sx, sy);
      if (!conflict && cover >= (placesOnly ? 0.99 : MIN_COVER) && !poolsDiffer(x, y)) best = Math.max(best, (sx + sy) / 2);
    }
  }
  return Math.min(1, best);
}

const INDOOR_POOL = /^hallen(bad|baeder)?$/;
const OUTDOOR_POOL = /^(strand|frei|see|fluss)(bad|baeder)?$|^badi$/;

/** An indoor pool and a lido of the same town ("Hallenbad Seefeld", "Strandbad Seefeld"). */
function poolsDiffer(x: readonly string[], y: readonly string[]): boolean {
  const kind = (ws: readonly string[]) => {
    const indoor = ws.some((w) => INDOOR_POOL.test(w));
    const outdoor = ws.some((w) => OUTDOOR_POOL.test(w));
    return indoor === outdoor ? null : indoor ? "indoor" : "outdoor";
  };
  const a = kind(x);
  const b = kind(y);
  return !!a && !!b && a !== b;
}

/** Approximate km for short distances. */
function km(a: Listing, b: Listing): number {
  const dLat = (b.lat! - a.lat!) * 111.2;
  const dLng = (b.lng! - a.lng!) * 111.2 * Math.cos((a.lat! * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/** Two listings can only be one thing if both are places, or both are events on a shared day, and their seasons overlap. */
function compatible(a: Listing, b: Listing): boolean {
  if (!!a.dates !== !!b.dates) return false;
  if (a.dates && b.dates) {
    const overlap = a.dates.some((x) => b.dates!.some((y) => x.start <= (y.end ?? y.start) && y.start <= (x.end ?? x.start)));
    if (!overlap) return false;
  }
  if (a.months?.length && b.months?.length && !a.months.some((m) => b.months!.includes(m))) return false;
  return true;
}

function rank(source: string): number {
  const i = SOURCE_RANK.indexOf(source);
  return i === -1 ? SOURCE_RANK.length : i;
}

export interface Match {
  a: string;
  b: string;
  km: number;
  score: number;
}

/** Pairs from different sources that are probably the same thing, best first. */
export function matchPairs(listings: readonly Listing[]): Match[] {
  const weight = wordWeights(listings);
  const located = listings.filter((l) => typeof l.lat === "number" && typeof l.lng === "number");
  // Grid of about 2 km cells; neighbours are in the same or an adjacent cell.
  const CELL = 0.02;
  const cellOf = (l: Listing) => [Math.floor(l.lat! / CELL), Math.floor(l.lng! / (CELL * 1.5))];
  const grid = new Map<string, Listing[]>();
  for (const l of located) {
    const key = cellOf(l).join(",");
    grid.set(key, [...(grid.get(key) ?? []), l]);
  }
  const out: Match[] = [];
  for (const a of located) {
    const [y, x] = cellOf(a);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const b of grid.get(`${y + dy},${x + dx}`) ?? []) {
          if (a.source === b.source || a.id >= b.id || !compatible(a, b)) continue;
          const d = km(a, b);
          if (d > MAX_KM) continue;
          const score = titleScore(a.title, b.title, weight);
          if (score >= (d <= NEAR_KM ? NEAR_SCORE : FAR_SCORE)) out.push({ a: a.id, b: b.id, km: d, score });
        }
      }
    }
  }
  return out.sort((p, q) => q.score - p.score || p.km - q.km);
}

/**
 * Groups of listings that are one thing, as listing id → id of the listing
 * shown for the group: the best-ranked source's, unless its title adds a
 * subtitle to a name another listing has alone. Pairs join groups best first,
 * and a group holds at most one listing per source, so a chain of loose
 * matches cannot pull two different places of one source together.
 */
export function findDuplicates(listings: readonly Listing[]): Map<string, string> {
  const group = new Map<string, Listing[]>(listings.map((l) => [l.id, [l]]));
  for (const { a, b } of matchPairs(listings)) {
    const ga = group.get(a)!;
    const gb = group.get(b)!;
    if (ga === gb || ga.some((x) => gb.some((y) => x.source === y.source))) continue;
    // Every member of the joined group must fit every other (seasons, dates).
    if (!ga.every((x) => gb.every((y) => compatible(x, y)))) continue;
    const joined = [...ga, ...gb];
    for (const l of joined) group.set(l.id, joined);
  }
  const out = new Map<string, string>();
  for (const members of new Set(group.values())) {
    if (members.length < 2) continue;
    const ranked = [...members].sort((x, y) => rank(x.source) - rank(y.source) || x.id.localeCompare(y.id));
    // The best listing may be one offer there ("Sattel Hochstuckli – Engelstock Winter Hike"); a listing named just the place shows the place.
    const plain = words(mainTitle(ranked[0].title)).join(" ");
    const named = mainTitle(ranked[0].title) !== ranked[0].title && ranked.find((l) => words(l.title).join(" ") === plain);
    const head = named || ranked[0];
    for (const l of members) if (l !== head) out.set(l.id, head.id);
  }
  return out;
}
