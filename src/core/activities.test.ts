import { describe, expect, it } from "vitest";
import {
  ageLabel,
  datesInRange,
  findIdeas,
  fitsBirthYear,
  hikeLine,
  inSeason,
  monthsInRange,
  seasonLabel,
  sourceShown,
  suggestedSetting,
  travelMinutes,
  weekendFrom,
  type Activity,
} from "./activities";

function act(over: Partial<Activity>): Activity {
  return { id: `test:${over.title ?? "x"}`, source: "swissfamilyfun", title: "x", url: "https://example.org", kind: "Hike", ...over };
}

describe("weekendFrom", () => {
  it("picks this weekend, including on Saturday and Sunday", () => {
    // 2026-10-13 is a Tuesday.
    expect(weekendFrom("2026-10-13")).toEqual({ start: "2026-10-17", end: "2026-10-18" });
    expect(weekendFrom("2026-10-17")).toEqual({ start: "2026-10-17", end: "2026-10-18" });
    expect(weekendFrom("2026-10-18")).toEqual({ start: "2026-10-17", end: "2026-10-18" });
    expect(weekendFrom("2026-10-13", 1)).toEqual({ start: "2026-10-24", end: "2026-10-25" });
  });
});

describe("season and dates", () => {
  it("lists the months a range touches, across the new year", () => {
    expect(monthsInRange("2026-12-28", "2027-01-03")).toEqual([12, 1]);
    expect(monthsInRange("2026-10-17", "2026-10-18")).toEqual([10]);
  });

  it("keeps year-round places and checks seasonal ones", () => {
    expect(inSeason(act({}), "2026-01-10", "2026-01-11")).toBe(true);
    expect(inSeason(act({ months: [6, 7, 8, 9, 10] }), "2026-10-17", "2026-10-18")).toBe(true);
    expect(inSeason(act({ months: [6, 7, 8, 9, 10] }), "2026-11-07", "2026-11-08")).toBe(false);
  });

  it("matches weekly courses only on their weekday", () => {
    const wednesday = act({ dates: [{ start: "2026-10-21", end: "2027-04-21" }], weekdays: [3] });
    expect(datesInRange(wednesday, "2026-10-24", "2026-10-25")).toEqual([]);
    expect(datesInRange(wednesday, "2026-10-26", "2026-10-30")).toHaveLength(1);
    const camp = act({ dates: [{ start: "2026-10-12", end: "2026-10-16" }] });
    expect(datesInRange(camp, "2026-10-05", "2026-10-16")).toHaveLength(1);
    expect(datesInRange(camp, "2026-10-17", "2026-10-18")).toEqual([]);
  });

  it("labels seasons, wrapping over the new year", () => {
    expect(seasonLabel([5, 6, 7, 8, 9, 10])).toBe("May–Oct");
    expect(seasonLabel([12, 1, 2, 3])).toBe("Dec–Mar");
    expect(seasonLabel([6])).toBe("Jun");
    expect(seasonLabel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe("");
    expect(seasonLabel(undefined)).toBe("");
  });
});

describe("ages", () => {
  it("uses exact birth years when the source gives them", () => {
    const a = act({ birthYears: [2014, 2019] });
    expect(fitsBirthYear(a, 2016, 2026)).toBe(true);
    expect(fitsBirthYear(a, 2020, 2026)).toBe(false);
    expect(ageLabel(a)).toBe("born 2014–2019");
  });

  it("allows a year of slack on age ranges", () => {
    const a = act({ ageMin: 6, ageMax: 10 });
    expect(fitsBirthYear(a, 2020, 2026)).toBe(true); // turns 6 this year
    expect(fitsBirthYear(a, 2021, 2026)).toBe(false); // 5 at most
    expect(fitsBirthYear(a, 2015, 2026)).toBe(true); // turns 11, may still be 10
    expect(fitsBirthYear(a, 2014, 2026)).toBe(false);
    expect(ageLabel(a)).toBe("6–10 y");
    expect(ageLabel(act({ ageMin: 6 }))).toBe("6+ y");
  });
});

describe("travel and weather", () => {
  it("prefers stated times and estimates from distance otherwise", () => {
    expect(travelMinutes(act({ transitMin: 70, carMin: 50 }))).toEqual({ minutes: 70, estimated: false });
    expect(travelMinutes(act({ distanceKm: 20 }))).toEqual({ minutes: 43, estimated: true });
    expect(travelMinutes(act({}))).toBeNull();
  });

  it("suggests indoor when rain is likely and outdoor when dry", () => {
    expect(suggestedSetting(80)).toBe("indoor");
    expect(suggestedSetting(10)).toBe("outdoor");
    expect(suggestedSetting(45)).toBe("any");
    expect(suggestedSetting(null)).toBe("any");
  });
});

describe("findIdeas", () => {
  const all: Activity[] = [
    act({ title: "Near hike", setting: "outdoor", transitMin: 30, months: [5, 6, 7, 8, 9, 10] }),
    act({ title: "Far hike", setting: "outdoor", transitMin: 150 }),
    act({ title: "Museum", kind: "Museum", setting: "indoor", distanceKm: 20 }),
    act({ title: "Summer pool", setting: "outdoor", months: [6, 7, 8], transitMin: 20 }),
    act({ title: "Camp", source: "sportamt", kind: "Holiday course", dates: [{ start: "2026-10-17", end: "2026-10-18" }], birthYears: [2014, 2019] }),
    act({ title: "Toddler group", source: "gz", dates: [{ start: "2026-10-17" }], ageMax: 4 }),
    act({ title: "Past camp", source: "gz", dates: [{ start: "2026-10-05" }] }),
    act({ title: "Full camp", source: "sportamt", dates: [{ start: "2026-10-17" }], booking: "closed" }),
    act({ title: "Saturday dance", source: "sportamt", dates: [{ start: "2026-08-17", end: "2027-01-30" }], weekdays: [6] }),
  ];
  const base = { start: "2026-10-17", end: "2026-10-18", setting: "any" as const, maxMinutes: null, birthYears: [] };

  it("splits dated offers from places and sorts places by travel time", () => {
    const ideas = findIdeas(all, base);
    expect(ideas.dated.map((d) => d.activity.title)).toEqual(["Camp", "Toddler group", "Full camp"]);
    expect(ideas.weekly.map((d) => d.activity.title)).toEqual(["Saturday dance"]);
    expect(ideas.places.map((a) => a.title)).toEqual(["Near hike", "Museum", "Far hike"]);
  });

  it("filters by setting, travel time, age and text", () => {
    expect(findIdeas(all, { ...base, setting: "indoor" }).places.map((a) => a.title)).toEqual(["Museum"]);
    expect(findIdeas(all, { ...base, maxMinutes: 60 }).places.map((a) => a.title)).toEqual(["Near hike", "Museum"]);
    expect(findIdeas(all, { ...base, birthYears: [2017] }).dated.map((d) => d.activity.title)).toEqual(["Camp", "Full camp"]);
    expect(findIdeas(all, { ...base, birthYears: [2023] }).dated.map((d) => d.activity.title)).toEqual(["Toddler group", "Full camp"]);
    expect(findIdeas(all, { ...base, text: "museum" }).places.map((a) => a.title)).toEqual(["Museum"]);
  });
});

describe("source settings", () => {
  const witikon = act({ title: "Werken", source: "gz", feed: "gz-witikon" });
  const hottingen = act({ title: "Tanz", source: "gz", feed: "gz-hottingen" });
  const hike = act({ title: "Hike" });

  it("hides whole sources or single feeds", () => {
    expect(sourceShown(witikon, new Set(["gz"]))).toBe(false);
    expect(sourceShown(witikon, new Set(["gz/gz-hottingen"]))).toBe(true);
    expect(sourceShown(hottingen, new Set(["gz/gz-hottingen"]))).toBe(false);
    expect(sourceShown(hike, new Set(["gz"]))).toBe(true);
  });

  it("leaves hidden sources out of the ideas", () => {
    const q = { start: "2026-10-17", end: "2026-10-18", setting: "any" as const, maxMinutes: null, birthYears: [] };
    const ideas = findIdeas([witikon, hottingen, hike], { ...q, hiddenSources: ["gz/gz-hottingen", "swissfamilyfun"] });
    expect(ideas.places.map((a) => a.title)).toEqual(["Werken"]);
  });
});

describe("hikeLine", () => {
  it("summarises a hike", () => {
    expect(hikeLine(act({ altitudeM: 1115, hike: { km: 3, loop: true, upM: 250, downM: 250, skill: "moderate" } }))).toBe(
      "3 km loop · ↑250 m · max 1115 m · moderate",
    );
    expect(hikeLine(act({ altitudeM: 2125, hike: { km: 10, hours: 4.5, upM: 340, downM: 1010 } }))).toBe(
      "10 km · 4.5 h · ↑340 m · ↓1010 m · max 2125 m",
    );
    expect(hikeLine(act({ altitudeM: 420 }))).toBe("");
    expect(hikeLine(act({ altitudeM: 1500 }))).toBe("1500 m");
  });
});
