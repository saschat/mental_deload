import { describe, expect, it } from "vitest";
import { findDuplicates, mainTitle, titleScore, wordWeights, words, type Listing } from "./duplicates";
import { findIdeas, mergeDuplicates, sourceShown, type Activity } from "./activities";

/** Listings far from the test spots, so common words ("Museum", "Strandbad") weigh little, as in the real index. */
const BACKGROUND: Listing[] = Array.from({ length: 200 }, (_, i) => ({
  id: `bg:${i}`,
  source: "osm",
  title: ["Museum", "Strandbad", "Hallenbad", "Park", "Zürich", "Spielplatz", "Kinder Farm", "Trail", "Schifffahrt", "Tierpark Festival"][i % 10] + ` Ort${i}`,
  place: ["Uster", "Kilchberg", "Baar", "Seegräben"][i % 4],
  lat: 46 + i * 0.05,
  lng: 7,
}));

function at(id: string, title: string, lat: number, lng: number, over: Partial<Listing> = {}): Listing {
  return { id, source: id.split(":")[0], title, lat, lng, ...over };
}

function groups(listings: Listing[]): Map<string, string> {
  return findDuplicates([...BACKGROUND, ...listings]);
}

describe("title words", () => {
  it("folds umlauts, drops small words and names Zürich one way", () => {
    expect(words("Höllgrotten Baar – die Tropfsteinhöhle")).toEqual(["hoellgrotten", "baar", "tropfsteinhoehle"]);
    expect(words("Zurich Landesmuseum")).toEqual(["zuerich", "landesmuseum"]);
    expect(words("Jucker Farm")).toEqual(["jucker", "hof"]);
  });

  it("cuts subtitles", () => {
    expect(mainTitle("Technorama Winterthur – Das einzige Science Center")).toBe("Technorama Winterthur");
    expect(mainTitle("Pfäffikersee Rundweg • Circular path")).toBe("Pfäffikersee Rundweg");
  });

  it("scores rare shared words high and a shared town low", () => {
    const w = wordWeights([...BACKGROUND, { source: "x", title: "Juckerhof" }, { source: "x", title: "Jucker Farm" }]);
    expect(titleScore("Juckerhof Seegräben – Der Erlebnisbauernhof", "Jucker Farm: Pumpkin Festival", w)).toBeGreaterThan(0.5);
    // Each names something the other lacks.
    expect(titleScore("Juckerhof Bauernhof", "Jucker Pumpkin", w)).toBe(0);
    expect(titleScore("Lindt Chocolateria in Kilchberg", "Strandbad Kilchberg", w)).toBe(0);
  });
});

describe("findDuplicates", () => {
  it("groups one place under the best-ranked source, with titles that differ", () => {
    const dups = groups([
      at("zuerich:1", "Juckerhof Seegräben – Der Erlebnisbauernhof am Pfäffikersee", 47.3301, 8.7612),
      at("freizeit:1", "Juckerhof in Aathal-Seegräben", 47.3303, 8.7615),
      at("swissfamilyfun:1", "Jucker Farm: Pumpkin Festival & Fruit Picking", 47.3299, 8.761),
      at("zuerioberland:1", "Juckerhof", 47.33, 8.7611),
    ]);
    expect(dups.get("zuerich:1")).toBe("swissfamilyfun:1");
    expect(dups.get("freizeit:1")).toBe("swissfamilyfun:1");
    expect(dups.get("zuerioberland:1")).toBe("swissfamilyfun:1");
    expect(dups.has("swissfamilyfun:1")).toBe(false);
  });

  it("matches English titles to German ones written as one word", () => {
    const dups = groups([at("swissfamilyfun:1", "Dinosaur Museum Aathal", 47.33, 8.76), at("freizeit:1", "Sauriermuseum Aathal", 47.3302, 8.7602)]);
    expect(dups.get("freizeit:1")).toBe("swissfamilyfun:1");
  });

  it("allows sources to place it up to 2 km apart when the names agree", () => {
    const dups = groups([at("familienausflug:1", "Höllgrotten Baar", 47.17, 8.53), at("freizeit:1", "Höllgrotten", 47.183, 8.535)]);
    expect(dups.get("freizeit:1")).toBe("familienausflug:1");
  });

  it("keeps apart neighbours that only share a word, a town or a lake", () => {
    const dups = groups([
      at("zuerich:1", "Wildnispark Zürich Sihlwald", 47.27, 8.55, { place: "Sihlwald" }),
      at("freizeit:1", "Wildnispark Zürich Langenberg", 47.2705, 8.5505),
      at("freizeit:2", "Langenberg Tiere", 47.6, 8.9),
      at("myswitzerland:1", "Langenberg Wildpark", 47.6, 9.1),
      at("osm:1", "Langenberg", 47.6, 9.3),
      at("zuerich:2", "Strandbad Seefeld Lachen", 47.19, 8.85),
      at("osm:2", "Hallenbad Seefeld", 47.1905, 8.8505),
      at("myswitzerland:2", "Zugersee Schifffahrt", 47.17, 8.51),
      at("freizeit:3", "Schifffahrt Ägerisee", 47.1705, 8.5105),
      at("zuerich:3", "Pfäffikersee", 47.35, 8.78),
      at("zuerioberland:1", "Museum am Pfäffikersee", 47.3505, 8.7805),
    ]);
    expect([...dups.keys()].filter((id) => !id.startsWith("bg:"))).toEqual([]);
  });

  it("keeps apart listings with the same name far away, or in seasons that do not meet", () => {
    const dups = groups([
      at("freizeit:1", "Seilpark Rigi", 47.05, 8.48),
      at("myswitzerland:1", "Seilpark Rigi", 47.1, 8.48),
      at("swissfamilyfun:1", "Sattel-Hochstuckli Sledding", 47.08, 8.63, { months: [12, 1, 2] }),
      at("zuerich:1", "Sattel-Hochstuckli im Sommer", 47.0805, 8.6305, { months: [5, 6, 7, 8] }),
    ]);
    expect([...dups.keys()].filter((id) => !id.startsWith("bg:"))).toEqual([]);
  });

  it("joins events only on a shared day, never with a place", () => {
    const show = (id: string, start: string) => at(id, "Tschüss, Papagei!", 47.36, 8.52, { dates: [{ start }] });
    expect(groups([show("kikuka:1", "2026-11-01"), show("gz:1", "2026-11-01")]).get("gz:1")).toBe("kikuka:1");
    expect(groups([show("kikuka:1", "2026-11-01"), show("gz:1", "2026-11-08")]).size).toBe(0);
    expect(groups([show("kikuka:1", "2026-11-01"), at("osm:1", "Tschüss, Papagei!", 47.36, 8.52)]).size).toBe(0);
  });

  it("holds at most one listing per source in a group", () => {
    const dups = groups([
      at("freizeit:1", "Schlossbadi Frauenfeld", 47.56, 8.9),
      at("osm:1", "Schlossbadi Frauenfeld", 47.5601, 8.9001),
      at("osm:2", "Schlossbadi Frauenfeld", 47.5602, 8.9002),
    ]);
    expect([...dups].filter(([id]) => !id.startsWith("bg:"))).toEqual([["osm:1", "freizeit:1"]]);
  });
});

describe("mergeDuplicates", () => {
  const head: Activity = { id: "swissfamilyfun:jucker", source: "swissfamilyfun", title: "Jucker Farm", url: "https://sff/jucker", kind: "Farm", lat: 47.33, lng: 8.76, months: [9, 10] };
  const zt: Activity = {
    id: "zuerich:1",
    source: "zuerich",
    title: "Juckerhof Seegräben",
    url: "https://zt/juckerhof",
    kind: "Animals",
    place: "Seegräben",
    months: [1, 2],
    costChf: 0,
    tags: ["Bauernhof"],
    duplicateOf: head.id,
  };
  const fz: Activity = { id: "freizeit:1", source: "freizeit", title: "Juckerhof", url: "https://fz/juckerhof", kind: "Animals", ageMin: 2, ageMax: 12, duplicateOf: head.id };
  const merged = mergeDuplicates([fz, head, zt]);

  it("shows one entry with the head's title and link and the others in also", () => {
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: head.id, title: "Jucker Farm", url: "https://sff/jucker" });
    expect(merged[0].also?.map((l) => l.source)).toEqual(["zuerich", "freizeit"]);
    expect(merged[0].duplicateOf).toBeUndefined();
  });

  it("keeps the head's facts and fills the ones it lacks", () => {
    expect(merged[0]).toMatchObject({ months: [9, 10], place: "Seegräben", costChf: 0, ageMin: 2, ageMax: 12, tags: ["Bauernhof"] });
  });

  it("keeps a listing whose head is gone", () => {
    expect(mergeDuplicates([zt]).map((a) => a.id)).toEqual(["zuerich:1"]);
  });

  it("shows it while any of its sources is on, and applies marks set on any listing", () => {
    expect(sourceShown(merged[0], new Set(["swissfamilyfun"]))).toBe(true);
    expect(sourceShown(merged[0], new Set(["swissfamilyfun", "zuerich", "freizeit"]))).toBe(false);
    const q = { start: "2026-10-17", end: "2026-10-18", setting: "any" as const, maxMinutes: null, birthYears: [] };
    expect(findIdeas(merged, { ...q, hidden: new Set(["freizeit:1"]) }).places).toEqual([]);
    expect(findIdeas(merged, { ...q, text: "juckerhof" }).places).toHaveLength(1);
  });
});
