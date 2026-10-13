import { describe, expect, it } from "vitest";
import { climateCell, monthlyNormals, typicalWeather, type DailyRow } from "./climate";

describe("climate", () => {
  it("snaps points to half-degree regions", () => {
    expect(climateCell(47.3779, 8.5403)).toBe("47.5,8.5");
    expect(climateCell(46.73, 10.21)).toBe("46.5,10");
  });

  it("reduces daily history to monthly highs and rainy-day shares", () => {
    const rows: DailyRow[] = [];
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      rows.push({ date: `2020-${mm}-01`, high: m, precipitationMm: 0 });
      rows.push({ date: `2021-${mm}-01`, high: m + 2, precipitationMm: m === 10 ? 5 : 0.4 });
    }
    const c = monthlyNormals(rows, 512.4)!;
    expect(c.elevationM).toBe(512);
    expect(c.high[9]).toBe(11);
    expect(c.rain[9]).toBe(50);
    expect(c.rain[0]).toBe(0);
    expect(monthlyNormals(rows.filter((r) => !r.date.includes("-03-")), 500)).toBeNull();
  });

  it("averages the months and cools with height", () => {
    const c = { elevationM: 500, high: Array.from({ length: 12 }, (_, i) => i * 2), rain: Array.from({ length: 12 }, () => 40) };
    expect(typicalWeather(c, [10])).toEqual({ high: 18, rain: 40 });
    expect(typicalWeather(c, [10, 11], 2500)).toEqual({ high: 6, rain: 40 });
    expect(typicalWeather(c, [])).toBeNull();
  });
});
