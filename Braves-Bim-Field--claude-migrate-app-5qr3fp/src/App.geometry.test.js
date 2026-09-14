import { describe, it, expect } from "vitest";
import {
  snap,
  dist,
  projectPointOnSegment,
  pointInPolygon,
  polygonCentroid,
  fitViewBoxToElements,
  wrapTextLines,
} from "./geometry.js";

describe("snap", () => {
  it("rounds to the nearest grid step (GRID = 20)", () => {
    expect(snap(0)).toBe(0);
    expect(snap(9)).toBe(0);
    expect(snap(11)).toBe(20);
    expect(snap(27)).toBe(20);
    expect(snap(-11)).toBe(-20);
  });
});

describe("dist", () => {
  it("computes euclidean distance between two points", () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(dist({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
  });
});

describe("projectPointOnSegment", () => {
  it("clamps the projection to the segment's endpoints", () => {
    const a = { x: 0, y: 0 }, b = { x: 10, y: 0 };
    expect(projectPointOnSegment({ x: -5, y: 3 }, a, b)).toMatchObject({ x: 0, y: 0 });
    expect(projectPointOnSegment({ x: 15, y: 3 }, a, b)).toMatchObject({ x: 10, y: 0 });
  });

  it("projects a point onto the middle of the segment", () => {
    const p = projectPointOnSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(p.x).toBe(5);
    expect(p.y).toBe(0);
    expect(p.t).toBe(0.5);
  });

  it("doesn't divide by zero for a degenerate (zero-length) segment", () => {
    const p = projectPointOnSegment({ x: 3, y: 4 }, { x: 1, y: 1 }, { x: 1, y: 1 });
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});

describe("pointInPolygon", () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

  it("returns true for a point inside the polygon", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
  });

  it("returns false for a point outside the polygon", () => {
    expect(pointInPolygon({ x: 20, y: 20 }, square)).toBe(false);
  });
});

describe("polygonCentroid", () => {
  it("averages the vertex coordinates", () => {
    const c = polygonCentroid([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    expect(c).toEqual({ x: 5, y: 5 });
  });
});

describe("fitViewBoxToElements", () => {
  it("falls back to the full {0,0,w,h} box when there's nothing to fit", () => {
    expect(fitViewBoxToElements([], 800, 600)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  it("centers the viewBox on a single wall's bounding box", () => {
    const vb = fitViewBoxToElements([{ type: "wall", x1: 0, y1: 0, x2: 100, y2: 0 }], 800, 600);
    // content center is (50, 0) — the fitted box must be centered on it
    const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
    expect(cx).toBeCloseTo(50, 5);
    expect(cy).toBeCloseTo(0, 5);
  });

  it("includes every element type's geometry in the bounding box (room far outside walls)", () => {
    const vb = fitViewBoxToElements(
      [
        { type: "wall", x1: 0, y1: 0, x2: 10, y2: 0 },
        { type: "room", points: [{ x: 900, y: 900 }, { x: 950, y: 950 }] },
      ],
      800,
      600
    );
    // the room's far corner must be within the fitted box
    expect(vb.x + vb.w).toBeGreaterThanOrEqual(950);
    expect(vb.y + vb.h).toBeGreaterThanOrEqual(950);
  });
});

describe("wrapTextLines", () => {
  it("returns a single empty line for empty input", () => {
    expect(wrapTextLines("", 10)).toEqual([""]);
  });

  it("keeps short text on one line", () => {
    expect(wrapTextLines("Sala 1", 20)).toEqual(["Sala 1"]);
  });

  it("wraps once the line would exceed maxChars", () => {
    const lines = wrapTextLines("Quarto principal suite master", 15);
    expect(lines.length).toBeGreaterThan(1);
    lines.forEach(l => expect(l.length).toBeLessThanOrEqual(15 + 20)); // words can exceed the limit alone
  });
});
