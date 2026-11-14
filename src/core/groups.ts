// Ideas that are the same outing at different places, shown as one idea that
// opens to the places: ice rinks, pools, playgrounds … and events a source
// runs under one title at several places or on several days (Kerzenziehen in
// fourteen GZs).

import type { Activity, ActivityDate, Ideas } from "./activities";

export interface IdeaGroup {
  /** "group:rinks" for kinds of place, "event:kerzenziehen" for events; marks use it like an activity id. */
  id: string;
  title: string;
}

export interface IdeaItem {
  activity: Activity;
  /** Dates in the range, for events. */
  dates?: ActivityDate[];
}

/** One idea in a list: a single listing, or a group of them with the first as its lead. */
export interface IdeaEntry {
  /** Set for members of a group even when only one is left after filtering, so a group mark still applies. */
  group?: IdeaGroup;
  items: IdeaItem[];
}

export interface GroupedIdeas {
  dated: IdeaEntry[];
  places: IdeaEntry[];
}

interface PlaceRule {
  id: string;
  title: string;
  /** Source labels that always mean this kind of place. */
  kinds?: string[];
  /** Words in the title that do. */
  words?: RegExp;
  /** Titles that match but are a destination of their own (a water park, a thermal bath). */
  except?: RegExp;
  setting?: "indoor" | "not-indoor";
}

/** First match wins, so indoor playgrounds come before playgrounds. */
const PLACE_RULES: PlaceRule[] = [
  { id: "rinks", title: "⛸️ Ice rinks", kinds: ["Ice skating"], words: /\b(eisbahn|eisfeld|eishalle|eispark|eislauf)|kunsteis|ice rink/ },
  {
    id: "pools",
    title: "🏊 Pools & lidos",
    // "Swimming" also labels lake walks and water parks, so only the pool labels and the words count.
    kinds: ["Pool", "Indoor pool", "Outdoor pool"],
    words: /\wbad\b|badi\b|schwümbi|badeplatz|badesee|badestrand|badeanstalt|badeinsel/,
    except: /therm|alpamare|aquabasilea|aquarena|erlebnisbad|wellenbad|papa moll|hammam|jugendherberge|wasserpark|water world|splash|schinznach|mineralbad|\bspa\b|wanderung|rundgang/,
  },
  { id: "indoor-play", title: "🧸 Indoor playgrounds", words: /spielplatz|spielparadies|spielwelt|kinderparadies|playground/, setting: "indoor" },
  { id: "playgrounds", title: "🛝 Playgrounds", words: /spielplatz|spielplätze|playground/, setting: "not-indoor" },
  // Rodelbahn alone is often a summer toboggan run.
  { id: "sledding", title: "🛷 Sledding runs", kinds: ["Sledding"], words: /schlittel/, except: /sommer|summer/ },
  { id: "climbing", title: "🧗 Climbing & bouldering halls", kinds: ["Climbing hall"], words: /boulder|kletterhalle|kletterzentrum/ },
  { id: "escape", title: "🔐 Escape rooms", words: /escape|adventure ?rooms|find.the.code|exit (adventure|game)|sato code/ },
  { id: "trampoline", title: "🤸 Trampoline parks", kinds: ["Trampoline park"], words: /trampolin/ },
  { id: "minigolf", title: "⛳ Minigolf", words: /mini.?golf|adventure.?golf|pit.?pat/ },
  { id: "bowling", title: "🎳 Bowling", words: /bowling/ },
];

/** Every kind of place that is grouped, for Settings or help text. */
export const PLACE_GROUPS: IdeaGroup[] = PLACE_RULES.map((r) => ({ id: `group:${r.id}`, title: r.title }));

/** The kind of place it is one of, for places that are much the same wherever you go. */
export function placeGroup(a: Pick<Activity, "title" | "kind" | "setting" | "dates">): IdeaGroup | undefined {
  if (a.dates) return undefined;
  const title = a.title.toLowerCase();
  const indoor = a.setting === "indoor" || /indoor/.test(title);
  const rule = PLACE_RULES.find(
    (r) =>
      (r.kinds?.includes(a.kind) || r.words?.test(title)) &&
      !r.except?.test(title) &&
      (r.setting === undefined || (r.setting === "indoor") === indoor),
  );
  return rule && { id: `group:${rule.id}`, title: rule.title };
}

/** Lower case without accents or punctuation: "Tschüss, Papagei!" → "tschuss papagei". */
const key = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Events under one title are one idea, whichever places and days they are on. Weekly courses are not grouped. */
export function eventGroup(a: Pick<Activity, "title" | "weekdays">): IdeaGroup | undefined {
  if (a.weekdays?.length) return undefined;
  const k = key(a.title);
  return k ? { id: `event:${k}`, title: a.title } : undefined;
}

export interface GroupOptions {
  groupOf: (a: Activity) => IdeaGroup | undefined;
  /** Listings shown on their own whatever their group, like favourites. */
  standalone?: (a: Activity) => boolean;
  /** Group ids marked not relevant: their members are left out. */
  hidden?: ReadonlySet<string>;
}

/** Folds the members of each group into one entry where its first member is, keeping the order. */
export function groupIdeas(items: readonly IdeaItem[], o: GroupOptions): IdeaEntry[] {
  const out: IdeaEntry[] = [];
  const byGroup = new Map<string, IdeaEntry>();
  for (const item of items) {
    const group = o.standalone?.(item.activity) ? undefined : o.groupOf(item.activity);
    if (!group) {
      out.push({ items: [item] });
      continue;
    }
    if (o.hidden?.has(group.id)) continue;
    const entry = byGroup.get(group.id);
    if (entry) entry.items.push(item);
    else {
      const e = { group, items: [item] };
      byGroup.set(group.id, e);
      out.push(e);
    }
  }
  return out;
}

/** Events grouped by title and places by kind; favourites stay on their own. */
export function groupedIdeas(ideas: Ideas, o: { favorites?: ReadonlySet<string>; hidden?: ReadonlySet<string> } = {}): GroupedIdeas {
  const standalone = (a: Activity) => !!o.favorites && [a.id, ...(a.also ?? []).map((l) => l.id)].some((id) => o.favorites!.has(id));
  return {
    dated: groupIdeas(ideas.dated, { groupOf: eventGroup, standalone, hidden: o.hidden }),
    places: groupIdeas(
      ideas.places.map((activity) => ({ activity })),
      { groupOf: placeGroup, standalone, hidden: o.hidden },
    ),
  };
}

/** Whether to show it as a group: two or more listings. */
export function isGroup(e: IdeaEntry): e is IdeaEntry & { group: IdeaGroup } {
  return !!e.group && e.items.length > 1;
}

/** Id for marks and pick history: the group's, or the listing's. */
export function entryId(e: IdeaEntry): string {
  return e.group?.id ?? e.items[0].activity.id;
}
