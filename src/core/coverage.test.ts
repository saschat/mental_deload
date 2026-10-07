import { describe, expect, it } from "vitest";
import {
  clipSegments,
  coverageFraction,
  fitSegments,
  isUndecided,
  kidSegmentSummary,
  relevantKidIds,
  removeSegment,
  setSegmentStatus,
  setStatusForAll,
  splitSegment,
  uncoveredRanges,
} from "./coverage";
import type { FamilyEvent, Segment } from "./types";

const kids = [{ id: "a" }, { id: "b" }];

function ev(segments: Segment[], extra: Partial<FamilyEvent> = {}) {
  return { start: "2026-07-01", end: "2026-07-14", segments, kidIds: [], ...extra };
}

describe("relevantKidIds", () => {
  it("defaults to all kids and ignores unknown ids", () => {
    expect(relevantKidIds({ kidIds: [] }, kids)).toEqual(["a", "b"]);
    expect(relevantKidIds({ kidIds: ["b", "zzz"] }, kids)).toEqual(["b"]);
    expect(relevantKidIds({ kidIds: ["zzz"] }, kids)).toEqual(["a", "b"]);
  });
});

describe("coverage", () => {
  it("is undecided without segments", () => {
    const e = ev([]);
    expect(isUndecided(e, kids)).toBe(true);
    expect(uncoveredRanges(e, "a")).toEqual([{ start: "2026-07-01", end: "2026-07-14" }]);
    expect(coverageFraction(e, kids)).toBe(0);
  });

  it("is decided once every day is covered for every relevant kid", () => {
    const segs = setStatusForAll(ev([]), ["a", "b"], "grandparents");
    const e = ev(segs);
    expect(isUndecided(e, kids)).toBe(false);
    expect(coverageFraction(e, kids)).toBe(1);
  });

  it("finds gaps between segments and partial kid coverage", () => {
    const segs: Segment[] = [
      { id: "1", start: "2026-07-01", end: "2026-07-07", statuses: { a: "grandparents", b: "grandparents" } },
      { id: "2", start: "2026-07-08", end: "2026-07-14", statuses: { a: "camp" } },
    ];
    const e = ev(segs);
    expect(uncoveredRanges(e, "a")).toEqual([]);
    expect(uncoveredRanges(e, "b")).toEqual([{ start: "2026-07-08", end: "2026-07-14" }]);
    expect(isUndecided(e, kids)).toBe(true);
    expect(isUndecided({ ...e, kidIds: ["a"] }, kids)).toBe(false);
    expect(coverageFraction(e, kids)).toBeCloseTo(21 / 28);
  });

  it("ignores segment parts outside the event", () => {
    const e = ev([{ id: "1", start: "2026-06-01", end: "2026-07-10", statuses: { a: "camp" } }]);
    expect(uncoveredRanges(e, "a")).toEqual([{ start: "2026-07-11", end: "2026-07-14" }]);
  });
});

describe("segment editing", () => {
  const base: Segment[] = [{ id: "s", start: "2026-07-01", end: "2026-07-14", statuses: { a: "camp", b: "camp" } }];

  it("splits a segment and copies statuses", () => {
    const out = splitSegment(base, "s", "2026-07-08");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ start: "2026-07-01", end: "2026-07-07" });
    expect(out[1]).toMatchObject({ start: "2026-07-08", end: "2026-07-14", statuses: { a: "camp", b: "camp" } });
    expect(isUndecided(ev(out), kids)).toBe(false);
  });

  it("refuses to split at the segment start or outside", () => {
    expect(splitSegment(base, "s", "2026-07-01")).toEqual(base);
    expect(splitSegment(base, "s", "2026-07-20")).toEqual(base);
  });

  it("removes a segment by extending its neighbour", () => {
    const split = splitSegment(base, "s", "2026-07-08");
    const out = removeSegment(split, split[1].id);
    expect(out).toEqual([{ ...split[0], end: "2026-07-14" }]);
    const out2 = removeSegment(split, split[0].id);
    expect(out2).toHaveLength(1);
    expect(out2[0]).toMatchObject({ start: "2026-07-01", end: "2026-07-14" });
  });

  it("sets and clears per-kid statuses", () => {
    const out = setSegmentStatus(base, "s", ["b"], "grandparents");
    expect(out[0].statuses).toEqual({ a: "camp", b: "grandparents" });
    expect(setSegmentStatus(out, "s", ["a"], null)[0].statuses).toEqual({ b: "grandparents" });
  });

  it("clips segments to a new range", () => {
    const split = splitSegment(base, "s", "2026-07-08");
    const out = clipSegments(split, "2026-07-09", "2026-07-20");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: "2026-07-09", end: "2026-07-14" });
  });

  it("fits segments to an extended range with empty gap segments", () => {
    const split = splitSegment(base, "s", "2026-07-08");
    const out = fitSegments(split, "2026-07-03", "2026-07-20");
    expect(out.map((s) => [s.start, s.end])).toEqual([
      ["2026-07-03", "2026-07-07"],
      ["2026-07-08", "2026-07-14"],
      ["2026-07-15", "2026-07-20"],
    ]);
    expect(out[2].statuses).toEqual({});
    expect(isUndecided({ start: "2026-07-03", end: "2026-07-20", segments: out, kidIds: [] }, [{ id: "a" }])).toBe(true);
  });
});

describe("kidSegmentSummary", () => {
  it("labels split segments by week", () => {
    const segs: Segment[] = [
      { id: "1", start: "2026-07-01", end: "2026-07-07", statuses: { a: "grandparents" } },
      { id: "2", start: "2026-07-08", end: "2026-07-14", statuses: { a: "camp" } },
    ];
    expect(kidSegmentSummary(ev(segs), "a")).toEqual([
      { label: "Wk1", status: "grandparents" },
      { label: "Wk2", status: "camp" },
    ]);
    expect(kidSegmentSummary(ev([]), "a")).toEqual([{ label: "", status: null }]);
  });
});
