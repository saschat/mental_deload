import { describe, expect, it } from "vitest";
import {
  compactDates,
  decodeEntities,
  inlineText,
  parseAges,
  parseChf,
  parseElevation,
  parseMonths,
  parseSuitableAge,
  parseTrail,
  parseTravelMinutes,
} from "./text.ts";

describe("decodeEntities / inlineText", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("B&#xFC;tzi &amp; Gr&#246;tzenb&uuml;el &#8211; ok&nbsp;!")).toBe("Bützi & Grötzenbüel – ok !");
  });
  it("flattens a table cell with line breaks", () => {
    expect(inlineText("Metered parking<br/>From Zürich 15 mins&nbsp;")).toBe("Metered parking / From Zürich 15 mins");
  });
});

describe("parseTravelMinutes", () => {
  it.each([
    ["1hr10 from Zurich", 70],
    ["Parking: Stachelbergstrasse 2, 8783 Glarus Süd Switzerland 1hr10 from Zurich", 70],
    ["about 15 mins from Zurich center", 15],
    ["~1hr from Zurich", 60],
    ["Metered parking at museum. / From Lucerne 5 mins, Zürich 45 mins", 45],
    ["Bus Stop: Luzern, Verkehrshaus/Lido stop / From: Lucerne train station 13 mins, Zürich 1hr05", 65],
    ["Free parking next to the Volg / 1hr from Basel or Bern, 1hr15 from Zürich", 75],
    ["2hr40 from Zurich HB, CHF 53.60 Adult Half-fare", 160],
    ["30 mins from Zurich HB to Bergstation Dolderbahn", 30],
  ])("%s → %i", (text, minutes) => {
    expect(parseTravelMinutes(text)).toBe(minutes);
  });

  it("gives up on lines without a Zürich time", () => {
    expect(parseTravelMinutes("1hr from Basel")).toBeUndefined();
    expect(parseTravelMinutes("no good connections, bus only runs twice a day")).toBeUndefined();
    expect(parseTravelMinutes(undefined)).toBeUndefined();
  });
});

describe("parseTrail", () => {
  it("reads distance, duration and loops", () => {
    expect(parseTrail("10 km one way, about 4.5 hours")).toEqual({ km: 10, hours: 4.5 });
    expect(parseTrail("3 km loop")).toEqual({ km: 3, loop: true });
    expect(parseTrail("3.7 km loop trail")).toEqual({ km: 3.7, loop: true });
    expect(parseTrail("3km round trip")).toEqual({ km: 3, loop: true });
    expect(parseTrail("500m to hut, 2-3km hikes from hut")).toEqual({ km: 3 });
    expect(parseTrail("4 km (longer option below)")).toEqual({ km: 4 });
  });
});

describe("parseElevation", () => {
  it.each([
    ["highest point 2125m, 340m up, 1010m down", { maxM: 2125, upM: 340, downM: 1010 }],
    ["highest point 1115, 250m climb, 250m descent", { maxM: 1115, upM: 250, downM: 250 }],
    ["2200m, 100m up/down", { maxM: 2200, upM: 100, downM: 100 }],
    ["highest point 893m, 220m up, 260m down", { maxM: 893, upM: 220, downM: 260 }],
  ])("%s", (text, expected) => {
    expect(parseElevation(text)).toEqual(expected);
  });
});

describe("parseMonths", () => {
  it("reads ranges in English and German", () => {
    expect(parseMonths("mid-June through October")).toEqual([6, 7, 8, 9, 10]);
    expect(parseMonths("best May to October, not good in rainy weather")).toEqual([5, 6, 7, 8, 9, 10]);
    expect(parseMonths("mid June through mid October")).toEqual([6, 7, 8, 9, 10]);
    expect(parseMonths("Dezember bis März")).toEqual([12, 1, 2, 3]);
  });
  it("treats year-round and opening hours as no season", () => {
    expect(parseMonths("year round")).toBeUndefined();
    expect(parseMonths("year round, only weekends off season")).toBeUndefined();
    expect(parseMonths("ganzjährig geöffnet")).toBeUndefined();
    expect(parseMonths("Open daily 10:00 to 17:00 and most public holidays")).toBeUndefined();
    expect(parseMonths(undefined)).toBeUndefined();
  });
});

describe("parseAges", () => {
  it.each([
    ["Für Kinder ab 6 Jahren.", { min: 6 }],
    ["Für Kinder zwischen 3-6 Jahren", { min: 3, max: 6 }],
    ["Für Kinder von 0-4 Jahren mit erwachsener Bezugsperson.", { min: 0, max: 4 }],
    ["Für Kinder bis ca. 4 Jahre in Begleitung.", { max: 4 }],
    ["Für Kinder ab der 1. Klasse", { min: 6 }],
    ["Jugendliche von der 4. bis 6. Klasse treffen sich", { min: 9, max: 12 }],
    ["JUGI K7 | ab der Oberstufe", { min: 12, max: 16 }],
    ["Für Väter, Mütter mit Babys & Kleinkindern", { min: 0, max: 2 }],
  ])("%s", (text, expected) => {
    expect(parseAges(text)).toEqual(expected);
  });
  it("returns nothing for text without ages", () => {
    expect(parseAges("Wir haben Platz für 20 Kinder.")).toEqual({});
  });
});

describe("parseSuitableAge", () => {
  it.each([
    ["So I only suggest this for experienced hikers and older children (over 12) that are prepared to manage the dangerous sections.", { min: 12 }],
    ["This trail is great for kids aged 4 and up.", { min: 4 }],
    ["Not recommended for kids under 8.", { min: 8 }],
    ["Ideal for children 3-10 years old.", { min: 3, max: 10 }],
    ["Best for families with kids 6+.", { min: 6 }],
  ])("%s", (text, expected) => {
    expect(parseSuitableAge(text)).toEqual(expected);
  });

  it("ignores ticket prices, durations and anecdotes", () => {
    expect(parseSuitableAge("In 2026, entrance costs CHF 17/adult, CHF 10/child aged 8-15, under 8 free.")).toEqual({});
    expect(parseSuitableAge("Fun for all ages and abilities.")).toEqual({});
    expect(parseSuitableAge("It's a good hike with kids, but it takes over 2 hours.")).toEqual({});
    expect(parseSuitableAge("My husband and 13 year old didn't think it was so bad.")).toEqual({});
  });
});

describe("parseChf", () => {
  it.each([
    ["CHF 10.-/ Material und kleiner Zvieri", 10],
    ["CHF 230.- pro Woche CHF 50.- pro Tag, inkl. Essen", 50],
    ["Adult CHF 8, Child CHF 4 (age 6-15), under 4 free", 4],
    ["CHF 17/adult, CHF 10/child age 8-15, under 7 free", 10],
    ["Kinder CHF 8.- Erwachsene CHF 12.-", 8],
    ["kostenlos / Kollekte", 0],
    ["Eintritt frei", 0],
    ["free", 0],
  ])("%s → %i", (text, chf) => {
    expect(parseChf(text)).toBe(chf);
  });
  it("is undefined when no price is stated", () => {
    expect(parseChf("Material Kosten Varieren von Angebot zu Angebot")).toBeUndefined();
  });
});

describe("compactDates", () => {
  it("merges consecutive days with the same time and keeps others apart", () => {
    expect(
      compactDates([
        { start: "2027-02-16", time: "10:00–16:00" },
        { start: "2027-02-15", time: "10:00–16:00" },
        { start: "2027-02-17", time: "10:00–16:00" },
        { start: "2027-02-17", time: "10:00–16:00" },
        { start: "2027-02-19", time: "10:00–16:00" },
        { start: "2027-02-20", time: "15:00–20:30" },
      ]),
    ).toEqual([
      { start: "2027-02-15", end: "2027-02-17", time: "10:00–16:00" },
      { start: "2027-02-19", time: "10:00–16:00" },
      { start: "2027-02-20", time: "15:00–20:30" },
    ]);
  });
});
