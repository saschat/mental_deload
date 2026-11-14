import { describe, expect, it } from "vitest";
import type { Activity } from "./activities";
import { eventGroup, groupedIdeas, isGroup, placeGroup } from "./groups";

function act(over: Partial<Activity>): Activity {
  return { id: `test:${over.title ?? "x"}`, source: "freizeit", title: "x", url: "https://example.org", kind: "Outing", ...over };
}

describe("placeGroup", () => {
  it("knows kinds of place by label or title words", () => {
    expect(placeGroup(act({ title: "Dolder Eisbahn", kind: "Outing" }))?.id).toBe("group:rinks");
    expect(placeGroup(act({ title: "Eishalle", kind: "Ice skating" }))?.id).toBe("group:rinks");
    expect(placeGroup(act({ title: "Strandbad Mythenquai", kind: "Swimming" }))?.id).toBe("group:pools");
    expect(placeGroup(act({ title: "Indoorspielplatz Einsiedeln", kind: "Playground" }))?.id).toBe("group:indoor-play");
    expect(placeGroup(act({ title: "Abenteuerspielplatz Robi", kind: "Playground", setting: "outdoor" }))?.id).toBe("group:playgrounds");
    expect(placeGroup(act({ title: "Schlitteln am Uetliberg", kind: "Sledding" }))?.id).toBe("group:sledding");
  });

  it("leaves destinations and look-alikes on their own", () => {
    expect(placeGroup(act({ title: "Alpamare", kind: "Swimming" }))).toBeUndefined();
    expect(placeGroup(act({ title: "Wanderung Klöntalersee", kind: "Swimming" }))).toBeUndefined();
    expect(placeGroup(act({ title: "Kreislauflehrpfad Oberglatt", kind: "Hike" }))).toBeUndefined();
    expect(placeGroup(act({ title: "Sommerrodelbahn Rischli", kind: "Adventure park" }))).toBeUndefined();
    expect(placeGroup(act({ title: "Eisbahn", kind: "Ice skating", dates: [{ start: "2026-12-01" }] }))).toBeUndefined();
  });
});

describe("groupedIdeas", () => {
  it("folds a group where its first member is and keeps favourites and hidden groups apart", () => {
    const a = act({ title: "Eisbahn A", kind: "Ice skating" });
    const zoo = act({ title: "Zoo" });
    const b = act({ title: "Eisbahn B", kind: "Ice skating" });
    const fav = act({ title: "Eisbahn Fav", kind: "Ice skating" });
    const g = groupedIdeas({ dated: [], weekly: [], places: [a, zoo, b, fav] }, { favorites: new Set([fav.id]) });
    expect(g.places.map((e) => e.items.map((i) => i.activity.title))).toEqual([["Eisbahn A", "Eisbahn B"], ["Zoo"], ["Eisbahn Fav"]]);
    expect(isGroup(g.places[0])).toBe(true);
    const hidden = groupedIdeas({ dated: [], weekly: [], places: [a, zoo, b] }, { hidden: new Set(["group:rinks"]) });
    expect(hidden.places.map((e) => e.items[0].activity.title)).toEqual(["Zoo"]);
  });

  it("groups events by title across places and sources, but not weekly courses", () => {
    const at = (title: string, place: string, source: Activity["source"] = "gz") => ({ activity: act({ title, place, source }), dates: [{ start: "2026-11-15" }] });
    const g = groupedIdeas({ dated: [at("Kerzenziehen", "GZ Affoltern"), at("Tschüss, Papagei!", "GZ Oerlikon"), at("kerzenziehen", "GZ Buchegg"), at("Tschüss Papagei", "Witikon", "kikuka")], weekly: [], places: [] });
    expect(g.dated.map((e) => e.items.length)).toEqual([2, 2]);
    expect(g.dated[1].group?.id).toBe("event:tschuss papagei");
    expect(eventGroup(act({ title: "Turnen", weekdays: [3] }))).toBeUndefined();
  });
});
