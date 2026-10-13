import { describe, expect, it } from "vitest";
import { climateCell, climateNormals, climatePoint, typicalWeather, type DailyRow } from "./climate";

describe("climate", () => {
  it("snaps points to half-degree regions", () => {
    expect(climateCell(47.3779, 8.5403)).toBe("47.5,8.5");
    expect(climateCell(46.73, 10.21)).toBe("46.5,10");
  });

  it("maps days to the closest 1st or 15th", () => {
    expect(climatePoint("2026-10-01")).toBe(18);
    expect(climatePoint("2026-10-07")).toBe(18);
    expect(climatePoint("2026-10-08")).toBe(19);
    expect(climatePoint("2026-10-22")).toBe(19);
    expect(climatePoint("2026-10-23")).toBe(20);
    expect(climatePoint("2026-12-31")).toBe(0);
  });

  it("reduces daily history to highs and rainy-day shares per point", () => {
    const rows: DailyRow[] = [];
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      for (const day of ["03", "15"]) {
        rows.push({ date: `2020-${mm}-${day}`, high: m, precipitationMm: 0 });
        rows.push({ date: `2021-${mm}-${day}`, high: m + 2, precipitationMm: m === 10 && day === "15" ? 5 : 0.4 });
      }
    }
    const c = climateNormals(rows, 512.4)!;
    expect(c.elevationM).toBe(512);
    expect(c.high).toHaveLength(24);
    expect(c.high[19]).toBe(11);
    expect(c.rain[19]).toBe(50);
    expect(c.rain[18]).toBe(0);
    expect(climateNormals(rows.filter((r) => !r.date.includes("-03-")), 500)).toBeNull();
  });

  it("averages the days and cools with height", () => {
    const c = { elevationM: 500, high: Array.from({ length: 24 }, (_, i) => i), rain: Array.from({ length: 24 }, (_, i) => i * 2) };
    // 6–7 Nov: both days belong to the 1 Nov point (20); 8 Nov is as close to the 15th and goes there.
    expect(typicalWeather(c, "2026-11-06", "2026-11-07")).toEqual({ high: 20, rain: 40 });
    expect(typicalWeather(c, "2026-11-07", "2026-11-08")).toEqual({ high: 21, rain: 41 });
    // 6–9 Nov: two days at point 20, two at point 21.
    expect(typicalWeather(c, "2026-11-06", "2026-11-09", 2500)).toEqual({ high: 8, rain: 41 });
    expect(typicalWeather({ ...c, high: c.high.slice(0, 12), rain: c.rain.slice(0, 12) }, "2026-11-07", "2026-11-08")).toBeNull();
  });
});
