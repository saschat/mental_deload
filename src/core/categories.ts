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
  Exhibition: "museum",
  "Factory visit": "museum",
  "sehenswerter Ort": "museum",
  Crafts: "creative",
  Music: "creative",
  Theatre: "creative",
  Film: "creative",
  Stories: "creative",
  Dance: "creative",
  Circus: "creative",
  Workshop: "creative",
  Event: "events",
  Market: "events",
  "Meet-up": "events",
  Trip: "trips",
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

type SettingGuess = "indoor" | "outdoor" | "mixed";

interface Placeable extends Categorizable {
  setting?: SettingGuess;
}

/** Labels that settle it, set from the source's own category ("Indoorspielplatz"). */
const SETTING_BY_STRONG_KIND: Record<string, SettingGuess> = {
  "Indoor play": "indoor",
  "Indoor pool": "indoor",
  "Climbing hall": "indoor",
  "Trampoline park": "indoor",
};

/**
 * Words in a title or tag that say whether it is indoors. First match wins,
 * so "Theater im Wald" is outdoors and "Zoologisches Museum" indoors.
 */
const SETTING_BY_TEXT: [RegExp, SettingGuess][] = [
  [/outdoor|open-air|freilicht|im wald\b|im garten|draussen|im freien|kürbisausstellung/, "outdoor"],
  [/hallen-? ?und (frei|strand)bad|frei- und hallenbad/, "mixed"],
  [
    /museum|indoor|halle\b|\bhallen|therme|thermal|hammam|wellness|\bspa\b|escape|find-the-code|sato code|boda borg|trampolin|spielparadies|kinderparadies|kinderwelt|spielzänti|paradisimo|tummelplatz|spielzimmer|spielecke|adventure arena|kids arena|boulder|planetarium|ausstellung|exhibit|miniatur|diorama|chocolarium|chocowelt|chocolate|schokolade|glasi|factory|fabrik|kino|cinema|film|video|foto|bowling|billard|squash|bibliothek|library|theater|atelier|werkstatt|lernlokal|flickstube|kerzenziehen|schnitz|grittibänz|coiffeu|babymassage|beratung|chrabbel|krabbel|spielgruppe|keramik|töpfer|mal(en|kurs|atelier)|basteln|nähen|kleister|koch|backen|code camp|coding|programmier|minecraft|game lab|lego|illustration|kinderdisco|disco\b|party|kaffee|zmorge|z.nacht|popcorn|cafeteria|raumausleihe|treff\b|jugendtreff|workshop|erste hilfe|resilienz|selbstbehauptung|zivilcourage|märchen|grotte|freiruum|tanz|dance|akrobatik|yoga|budo|judo|karate|jitsu|kung fu|taekwondo|boxen|crossfit|fechten|selbstverteidigung|ninja|badminton|basketball|volleyball|handball|unihockey|tischtennis|tischfussball|curling|synchronschwimmen|artistic swimming|wasserspringen|tiny hands|indoor golf/,
    "indoor",
  ],
  [/schloss|castle|burg\b|kloster|sternwarte|flohm|börse|tausch|bring- und hol|bringen & holen|zirkus|circus|eislauf|eiskunst|eishockey|tennis|padel|bogenschiess|polysport|chlaus/, "mixed"],
  [
    /wander|hike|hiking|trail|weg\b|pfad|spazier|spielplatz|robinson|zoo\b|tierpark|wildpark|vogelpark|papageienwelt|freizeitpark|conny-land|seilpark|kletterpark|aussicht|rheinfall|wasserfall|waterfall|lookout|viewpoint|freibad|strandbad|badi\b|frozen lake|\bsee\b|lake|river|fluss|wald|forest|natur|nature|garten|garden|bauernhof|farm|stall\b|tiere|schöfli|alp\b|berg\b|gipfel|summit|bahn\b|schlitt|sled|\bski(?!ll)|snow|velo|bike|biking|pumptrack|skate|minigolf|fussball|girlskick|landhockey|reiten|voltige|rudern|segeln|markt|market|umz[uü]g|parade|räbe|lichterfest|via advent|village|town|itinerary|fishing|tulip|festival|picnic|grill|feuer/,
    "outdoor",
  ],
];

/** Labels that hint at it when the words don't: crafts and games at a GZ take place in the centre. */
const SETTING_BY_KIND: Record<string, SettingGuess> = {
  Crafts: "indoor",
  Games: "indoor",
  Stories: "indoor",
  Music: "indoor",
  Theatre: "indoor",
  Film: "indoor",
  "Meet-up": "indoor",
  Museum: "indoor",
  Exhibition: "indoor",
  Workshop: "indoor",
  Dance: "indoor",
  "Factory visit": "indoor",
  "Escape room": "indoor",
  Hike: "outdoor",
  Playground: "outdoor",
  Animals: "outdoor",
  Naturerlebnis: "outdoor",
  Aussichtspunkt: "outdoor",
};

/**
 * Sources whose label (the KiKuKa Sparte: theatre, music …) says more than
 * loose words in a title or venue ("Karneval der Tiere", "Stall 6"); only
 * the clear outdoor and pool words come first.
 */
const KIND_FIRST = new Set(["kikuka"]);
const CLEAR_RULES = 2;

/**
 * Sources whose own indoor/outdoor is kept when set: OSM tags, swissfamilyfun's
 * sections and the indoor/outdoor classes of Zürich, Zürioberland and Switzerland Tourism say it best.
 */
const OWN_SETTING = new Set(["osm", "swissfamilyfun", "zuerich", "zuerioberland", "myswitzerland"]);

/**
 * Sources that set it themselves. For the others, a stored value came from an
 * earlier run of these rules and is not used as a fallback, so rule changes apply.
 */
const SETS_SETTING = new Set([...OWN_SETTING, "familienausflug"]);

/**
 * Indoor or outdoor from the entry's words. familienausflug's weather tags
 * mark most places as good in rain and sun alike, so a clear word or category
 * wins over them there. Undefined when nothing says.
 */
export function settingFromText(a: Placeable): SettingGuess | undefined {
  if (a.setting && OWN_SETTING.has(a.source)) return a.setting;
  const strong = SETTING_BY_STRONG_KIND[a.kind];
  if (strong) return strong;
  const hay = [a.title, ...(a.tags ?? [])].join(" ").toLowerCase();
  for (const [i, [re, setting]] of SETTING_BY_TEXT.entries()) {
    if (i === CLEAR_RULES && KIND_FIRST.has(a.source) && SETTING_BY_KIND[a.kind]) return SETTING_BY_KIND[a.kind];
    if (re.test(hay)) return setting;
  }
  return SETTING_BY_KIND[a.kind] ?? (SETS_SETTING.has(a.source) ? a.setting : undefined);
}
