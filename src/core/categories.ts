/**
 * Activity categories for the Ideas filter. Kept free of imports so the
 * indexer (scripts/activities, run by plain Node) can use the same rules.
 */

interface Categorizable {
  source: string;
  kind: string;
  title: string;
  tags?: string[];
}

export type ActivityCategory =
  | "hike"
  | "nature"
  | "animals"
  | "play"
  | "swim"
  | "winter"
  | "sport"
  | "museum"
  | "creative"
  | "events"
  | "trips"
  | "other";

/** Category chips on the Ideas page, in display order. */
export const CATEGORIES: { id: ActivityCategory; label: string }[] = [
  { id: "hike", label: "🥾 Hikes" },
  { id: "nature", label: "⛰️ Nature" },
  { id: "animals", label: "🐐 Animals" },
  { id: "play", label: "🛝 Play" },
  { id: "swim", label: "🏊 Pools" },
  { id: "winter", label: "❄️ Snow & ice" },
  { id: "sport", label: "⚽ Sport" },
  { id: "museum", label: "🏛️ Museums" },
  { id: "creative", label: "🎨 Creative" },
  { id: "events", label: "🎪 Events" },
  { id: "trips", label: "🏘️ Towns & trips" },
  { id: "other", label: "✨ Other" },
];

/** Source labels (`kind`) that already say what an entry is about. */
const CATEGORY_BY_KIND: Record<string, ActivityCategory> = {
  Hike: "hike",
  Nature: "nature",
  Mountain: "nature",
  Camping: "nature",
  Naturerlebnis: "nature",
  Aussichtspunkt: "nature",
  Animals: "animals",
  Playground: "play",
  "Indoor play": "play",
  "Trampoline park": "play",
  "Theme park": "play",
  "Adventure park": "play",
  "Escape room": "play",
  Games: "play",
  Swimming: "swim",
  Pool: "swim",
  "Indoor pool": "swim",
  "Outdoor pool": "swim",
  Snow: "winter",
  Sledding: "winter",
  "Ice skating": "winter",
  Climbing: "sport",
  "Climbing hall": "sport",
  Sports: "sport",
  Biking: "sport",
  Movement: "sport",
  Museum: "museum",
  Castle: "museum",
  "Factory visit": "museum",
  "sehenswerter Ort": "museum",
  Crafts: "creative",
  Music: "creative",
  Theatre: "creative",
  Film: "creative",
  Stories: "creative",
  Event: "events",
  Market: "events",
  "Meet-up": "events",
};

/**
 * For generic labels (holiday camps and courses, "Outing", "Offer"), the topic
 * is read from tags and title. First match wins.
 */
const CATEGORY_BY_TOPIC: [RegExp, ActivityCategory][] = [
  [/schwimm|wasserspring|wasserball|tauch|\bpool|swim|hallenbad|freibad/, "swim"],
  [/eiskunst|eishockey|curling|\bski|snow|schlitt|sled/, "winter"],
  [/\btier|kleintier|haustier|zoo|pferd|reiten|voltigier|animal|bauernhof|\bfarm|hund|schöfli|\bschaf|ziege|\besel/, "animals"],
  [/trail|detektiv|schnitzeljagd|hike|wander/, "hike"],
  [/spielplatz|indoorspiel|trampolin/, "play"],
  [/market|märt|festival|cultural|christmas|parade|fasnacht/, "events"],
  [/cities|villages|town|itinerar|weekend|european|bahn|restaurant/, "trips"],
  [/museum|castle|schloss|burg\b/, "museum"],
  [/handwerk|gestalten|werken|wissenschaft|technik|theater|musik|music|zirkus|circus|code|coding|game|keramik|malen|malwerkstatt|kreativ|foto|film|classes|basteln|kochen|backen|märchen/, "creative"],
  [/natur|wald|abenteuer|outdoor|fishing|glacier|rafting|river|garten/, "nature"],
  [/selbstverteidigung|yoga|tanz|bewegung|sport|turn|kampf|klettern|velo|bike/, "sport"],
  [/treff|event|fest\b|familienevent/, "events"],
];

/** The category an entry belongs to. Sportamt courses are sport unless their topic says otherwise. */
export function categorize(a: Categorizable): ActivityCategory {
  const byKind = CATEGORY_BY_KIND[a.kind];
  if (byKind) return byKind;
  const hay = [...(a.tags ?? []), a.title].join(" ").toLowerCase();
  for (const [re, category] of CATEGORY_BY_TOPIC) if (re.test(hay)) return category;
  return a.source === "sportamt" ? "sport" : "other";
}
