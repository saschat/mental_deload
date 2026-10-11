import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import {
  climateQueryRange,
  combineWeekend,
  eventWeekendWeather,
  FORECAST_DAYS,
  forecastByDate,
  forecastWindowEnd,
  formatWeekendWeather,
  inForecastWindow,
  monthDayKey,
  parseOpenMeteoDaily,
  reduceClimate,
  type ClimateTable,
  type DayWeather,
  type ForecastDay,
} from "./weather";

function day(partial: Partial<DayWeather> & Pick<DayWeather, "source">): DayWeather {
  return {
    high: 10,
    low: 4,
    rainProbability: 10,
    snowfallCm: null,
    ...partial,
  };
}

describe("reduceClimate", () => {
  it("averages temperature and counts wet years for each month-day", () => {
    const table = reduceClimate([
      { date: "2016-10-17", high: 10, low: 4, precipitationMm: 0 },
      { date: "2017-10-17", high: 14, low: 6, precipitationMm: 1 },
      { date: "2018-10-17", high: 12, low: 2, precipitationMm: 3.5 },
      { date: "2019-10-17", high: 16, low: 8, precipitationMm: 0.9 },
      { date: "2016-10-18", high: 20, low: 9, precipitationMm: 0 },
    ]);
    expect(table["10-17"]).toEqual({ high: 13, low: 5, rainProbability: 50 });
    expect(table["10-18"]).toEqual({ high: 20, low: 9, rainProbability: 0 });
  });

  it("skips leap day and nulls without dropping the other years", () => {
    const table = reduceClimate([
      { date: "2016-02-28", high: 8, low: 1, precipitationMm: 2 },
      { date: "2020-02-29", high: 99, low: 99, precipitationMm: 50 },
      { date: "2020-02-28", high: null, low: 3, precipitationMm: 0 },
      { date: "2021-02-28", high: 6, low: null, precipitationMm: null },
      { date: "not-a-date", high: 1, low: 1, precipitationMm: 1 },
      { date: "2020-02-31", high: 1, low: 1, precipitationMm: 1 },
    ]);
    expect(table["02-29"]).toBeUndefined();
    expect(table["02-28"]).toEqual({ high: 7, low: 2, rainProbability: 50 });
    expect(Object.keys(table)).toEqual(["02-28"]);
  });

  it("omits a month-day that never has all three measurements", () => {
    expect(reduceClimate([{ date: "2016-01-01", high: 1, low: null, precipitationMm: 0 }])).toEqual({});
    expect(reduceClimate([])).toEqual({});
  });
});

describe("parseOpenMeteoDaily", () => {
  it("reads parallel daily arrays and ignores holes", () => {
    const rows = parseOpenMeteoDaily({
      daily: {
        time: ["2026-10-11", "bad", "2026-10-12", "2026-10-13"],
        temperature_2m_max: [14.2, 1, null, "15"],
        temperature_2m_min: [7, 1, 3, 4],
        precipitation_probability_max: [40, 1, 10, 150],
        precipitation_sum: [0.2, 1, 1, 2],
        snowfall_sum: [0, 1, 1.2, null],
      },
    });
    expect(rows).toEqual([
      { date: "2026-10-11", high: 14.2, low: 7, precipitationMm: 0.2, rainProbability: 40, snowfallCm: 0 },
      { date: "2026-10-12", high: null, low: 3, precipitationMm: 1, rainProbability: 10, snowfallCm: 1.2 },
      { date: "2026-10-13", high: null, low: 4, precipitationMm: 2, rainProbability: 100, snowfallCm: null },
    ]);
    expect(forecastByDate(rows)).toEqual({
      "2026-10-11": { high: 14.2, low: 7, rainProbability: 40, snowfallCm: 0 },
    });
  });

  it("returns nothing when the body is not a daily payload", () => {
    expect(parseOpenMeteoDaily(null)).toEqual([]);
    expect(parseOpenMeteoDaily({ error: true })).toEqual([]);
    expect(parseOpenMeteoDaily({ daily: { temperature_2m_max: [1] } })).toEqual([]);
    expect(parseOpenMeteoDaily({ daily: { time: [] } })).toEqual([]);
  });
});

describe("combineWeekend", () => {
  it("uses the higher high, the lower low, and the higher rain probability", () => {
    const summary = combineWeekend(
      day({ source: "forecast", high: 14, low: 8, rainProbability: 20, snowfallCm: 0.4 }),
      day({ source: "forecast", high: 11, low: 3, rainProbability: 40, snowfallCm: 0 }),
    );
    expect(summary).toMatchObject({ high: 14, low: 3, rainProbability: 40, snow: false, source: "forecast" });
  });

  it("notes snow at 1 cm and ignores a dusting", () => {
    expect(
      combineWeekend(day({ source: "forecast", snowfallCm: 0.9 }), day({ source: "forecast", snowfallCm: 0 })).snow,
    ).toBe(false);
    expect(
      combineWeekend(day({ source: "forecast", snowfallCm: 1 }), day({ source: "forecast", snowfallCm: null })).snow,
    ).toBe(true);
  });

  it("labels mixed when the two days come from different sources", () => {
    const summary = combineWeekend(
      day({ source: "forecast", snowfallCm: 1.5 }),
      day({ source: "typical" }),
    );
    expect(summary.source).toBe("mixed");
    expect(summary.snow).toBe(true);
  });
});

describe("weekend weather selection", () => {
  const today = "2026-10-16";
  const climate: ClimateTable = {
    "10-31": { high: 12, low: 5, rainProbability: 30 },
    "11-01": { high: 11, low: 4, rainProbability: 55 },
    "10-24": { high: 1, low: 0, rainProbability: 1 },
    "10-25": { high: 1, low: 0, rainProbability: 1 },
    "02-28": { high: 6, low: 0, rainProbability: 40 },
  };
  const forecast: Record<string, ForecastDay> = {
    "2026-10-24": { high: 18, low: 9, rainProbability: 10, snowfallCm: 0 },
    "2026-10-25": { high: 15, low: 6, rainProbability: 25, snowfallCm: 0 },
    "2026-10-31": { high: 9, low: 2, rainProbability: 80, snowfallCm: 2 },
  };

  it("covers 16 days inclusive of today", () => {
    expect(FORECAST_DAYS).toBe(16);
    expect(forecastWindowEnd(today)).toBe("2026-10-31");
    expect(inForecastWindow(today, today)).toBe(true);
    expect(inForecastWindow("2026-10-31", today)).toBe(true);
    expect(inForecastWindow(addDays(today, 16), today)).toBe(false);
    expect(inForecastWindow("2026-10-15", today)).toBe(false);
  });

  it("uses the forecast for a weekend inside the window", () => {
    const summary = eventWeekendWeather(
      { category: "weekend", start: "2026-10-24", end: "2026-10-25" },
      today,
      forecast,
      climate,
    );
    expect(summary).toMatchObject({ high: 18, low: 6, rainProbability: 25, source: "forecast", snow: false });
  });

  it("uses typical weather once both days are outside the window", () => {
    const summary = eventWeekendWeather(
      { category: "weekend", start: "2026-11-07", end: "2026-11-08" },
      today,
      forecast,
      { "11-07": { high: 10, low: 3, rainProbability: 20 }, "11-08": { high: 8, low: 1, rainProbability: 60 } },
    );
    expect(summary).toMatchObject({ high: 10, low: 1, rainProbability: 60, source: "typical", snow: false });
  });

  it("mixes forecast and typical when only Saturday is still inside 16 days", () => {
    const summary = eventWeekendWeather(
      { category: "weekend", start: "2026-10-31", end: "2026-11-01" },
      today,
      forecast,
      climate,
    );
    expect(summary).toMatchObject({ high: 11, low: 2, rainProbability: 80, source: "mixed", snow: true });
    expect(formatWeekendWeather(summary!).source).toBe("mixed");
  });

  it("keeps forecast temperatures when rain probability is missing", () => {
    const summary = eventWeekendWeather(
      { category: "weekend", start: "2026-10-24", end: "2026-10-25" },
      today,
      {
        "2026-10-24": { high: 15.4, low: 6, rainProbability: 25, snowfallCm: 0 },
        "2026-10-25": { high: 15, low: 6.7, rainProbability: null, snowfallCm: 0 },
      },
      { "10-25": { high: 1, low: 0, rainProbability: 70 } },
    );
    expect(summary).toMatchObject({ high: 15.4, low: 6, rainProbability: 70, source: "mixed", snow: false });
    expect(
      eventWeekendWeather(
        { category: "weekend", start: "2026-10-24", end: "2026-10-25" },
        today,
        {
          "2026-10-24": { high: 15.4, low: 6, rainProbability: 25, snowfallCm: 0 },
          "2026-10-25": { high: 15, low: 6.7, rainProbability: null, snowfallCm: 0 },
        },
        {},
      ),
    ).toBeNull();
  });

  it("falls back to typical for a window day the forecast did not return", () => {
    const summary = eventWeekendWeather(
      { category: "weekend", start: "2026-10-24", end: "2026-10-25" },
      today,
      { "2026-10-24": forecast["2026-10-24"] },
      climate,
    );
    expect(summary).toMatchObject({ high: 18, low: 0, rainProbability: 10, source: "mixed" });
  });

  it("returns nothing when a day has neither forecast nor climate", () => {
    expect(
      eventWeekendWeather(
        { category: "weekend", start: "2026-11-07", end: "2026-11-08" },
        today,
        {},
        {},
      ),
    ).toBeNull();
    expect(
      eventWeekendWeather(
        { category: "weekend", start: "2026-10-31", end: "2026-11-01" },
        today,
        { "2026-10-31": forecast["2026-10-31"] },
        {},
      ),
    ).toBeNull();
  });

  it("ignores other categories and a single-day range", () => {
    for (const category of ["school", "vacation", "birthday", "other"] as const) {
      expect(
        eventWeekendWeather({ category, start: "2026-10-24", end: "2026-10-25" }, today, forecast, climate),
      ).toBeNull();
    }
    expect(
      eventWeekendWeather({ category: "weekend", start: "2026-10-24", end: "2026-10-24" }, today, forecast, climate),
    ).toBeNull();
  });

  it("reads 29 Feb from the 28 Feb climate normal", () => {
    expect(monthDayKey("2028-02-29")).toBe("02-28");
    const summary = eventWeekendWeather(
      { category: "weekend", start: "2028-02-28", end: "2028-02-29" },
      "2026-10-16",
      {},
      climate,
    );
    expect(summary).toMatchObject({ high: 6, low: 0, rainProbability: 40, source: "typical", snow: false });
  });
});

describe("formatWeekendWeather", () => {
  it("rounds to a compact temperature and rain line", () => {
    expect(
      formatWeekendWeather({ high: 14.4, low: 6.6, rainProbability: 39.6, snow: false, source: "typical" }),
    ).toEqual({ temp: "14° / 7°", rain: "rain 40%", snow: null, source: "typical" });
    expect(
      formatWeekendWeather({ high: 14.5, low: -1.2, rainProbability: 0, snow: true, source: "forecast" }),
    ).toEqual({ temp: "15° / -1°", rain: "rain 0%", snow: "snow", source: "forecast" });
  });
});

describe("climateQueryRange", () => {
  it("asks for about ten years ending a week ago", () => {
    expect(climateQueryRange("2026-10-11")).toEqual({ start: "2016-10-04", end: "2026-10-04" });
  });

  it("does not request a leap day in a non-leap start year", () => {
    expect(climateQueryRange("2024-03-07")).toEqual({ start: "2014-02-28", end: "2024-02-29" });
  });
});
