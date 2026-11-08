import { describe, expect, it } from "vitest";
import type { Activity, Ideas } from "./activities";
import { pickIdeas, rememberPicks, shownBefore } from "./picks";

function act(over: Partial<Activity>): Activity {
  return { id: `test:${over.title ?? "x"}`, source: "swissfamilyfun", title: "x", url: "https://example.org", kind: "Hike", place: "Zürich", ...over };
}
const ideas = (places: Activity[], dated: Ideas["dated"] = []): Ideas => ({ dated, weekly: [], places });
const titles = (picks: { activity: Activity }[]) => picks.map((p) => p.activity.title);
const weekend = { start: "2026-11-14", end: "2026-11-15" };

describe("pickIdeas", () => {
  it("prefers close places that several sources list", () => {
    const near = act({ title: "Near", category: "hike", carMin: 10 });
    const far = act({ title: "Far", category: "museum", carMin: 70 });
    const popular = act({ title: "Popular", category: "nature", carMin: 25, also: [{ id: "a", source: "freizeit", title: "P", url: "" }, { id: "b", source: "zuerich", title: "P", url: "" }] });
    expect(titles(pickIdeas(ideas([far, near, popular]), weekend))).toEqual(["Popular", "Near", "Far"]);
  });

  it("puts events on the dates above long runs and thin listings below", () => {
    const show = act({ title: "Show", category: "events", carMin: 20 });
    const exhibition = act({ title: "Exhibition", category: "museum", carMin: 20 });
    const pool = act({ title: "Pool", source: "osm", kind: "Outdoor pool", place: undefined, category: "swim", carMin: 20 });
    const picks = pickIdeas(
      ideas([pool], [
        { activity: exhibition, dates: [{ start: "2026-10-01", end: "2027-02-01" }] },
        { activity: show, dates: [{ start: "2026-11-14" }] },
      ]),
      weekend,
    );
    expect(titles(picks)).toEqual(["Show", "Exhibition", "Pool"]);
    expect(picks[0].dates).toEqual([{ start: "2026-11-14" }]);
  });

  it("moves indoor places up when it rains", () => {
    const hike = act({ title: "Hike", category: "hike", setting: "outdoor", carMin: 10 });
    const museum = act({ title: "Museum", category: "museum", setting: "indoor", carMin: 20 });
    expect(titles(pickIdeas(ideas([hike, museum]), weekend))).toEqual(["Hike", "Museum"]);
    expect(titles(pickIdeas(ideas([hike, museum]), { ...weekend, rain: 80 }))).toEqual(["Museum", "Hike"]);
  });

  it("takes one per category first and fills up after", () => {
    const hikes = [10, 11, 12].map((m) => act({ title: `Hike ${m}`, category: "hike", carMin: m }));
    const museum = act({ title: "Museum", category: "museum", carMin: 40 });
    expect(titles(pickIdeas(ideas([...hikes, museum]), { ...weekend, count: 3 }))).toEqual(["Hike 10", "Museum", "Hike 11"]);
  });

  it("lists favourites first and leaves fully booked events out", () => {
    const fav = act({ title: "Fav", category: "museum", carMin: 60 });
    const near = act({ title: "Near", category: "hike", carMin: 5 });
    const full = act({ title: "Full", category: "events", carMin: 5, booking: "closed" });
    const picks = pickIdeas(ideas([near, fav], [{ activity: full, dates: [{ start: "2026-11-14" }] }]), { ...weekend, favorites: new Set([fav.id]) });
    expect(titles(picks)).toEqual(["Fav", "Near"]);
  });

  it("makes room for others after two weekends as a pick", () => {
    const a = act({ title: "A", category: "hike", carMin: 10 });
    const b = act({ title: "B", category: "hike", carMin: 20 });
    const once = new Map([[a.id, 1]]);
    const twice = new Map([[a.id, 2]]);
    expect(titles(pickIdeas(ideas([a, b]), { ...weekend, count: 1, shownBefore: once }))).toEqual(["A"]);
    expect(titles(pickIdeas(ideas([a, b]), { ...weekend, count: 1, shownBefore: twice }))).toEqual(["B"]);
  });
});

describe("pick history", () => {
  it("counts earlier dates only and forgets after eight weeks", () => {
    let h = rememberPicks({}, "2026-11-07", ["a", "b"], "2026-11-03");
    h = rememberPicks(h, "2026-11-14", ["a"], "2026-11-10");
    h = rememberPicks(h, "2026-11-14", ["a"], "2026-11-10");
    expect(h).toEqual({ a: ["2026-11-07", "2026-11-14"], b: ["2026-11-07"] });
    expect(shownBefore(h, "2026-11-14")).toEqual(new Map([["a", 1], ["b", 1]]));
    expect(shownBefore(h, "2026-11-21")).toEqual(new Map([["a", 2], ["b", 1]]));
    expect(rememberPicks(h, "2027-01-09", [], "2027-01-08")).toEqual({ a: ["2026-11-14"] });
  });
});
