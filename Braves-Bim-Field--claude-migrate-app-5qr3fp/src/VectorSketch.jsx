import { useState, useRef, useLayoutEffect } from "react";
import {
  Grid3x3, Grid2x2, X, Trash2, RotateCcw, DoorClosed, BrickWall, Pencil, Undo2, Eraser,
  LayoutPanelTop, ZoomIn, ZoomOut, Maximize2, MousePointer2, Lightbulb, Link2, Scissors, Ruler, CornerUpRight,
} from "lucide-react";
import { C, mono, heading, phaseColor } from "./theme.js";
import { toNum, uid } from "./utils.js";
import { WALL_TYPES, DOOR_TYPES, WINDOW_TYPES, FLOOR_TYPES, CEILING_TYPES, wallThicknessM } from "./constants.js";
import { GRID, snap, dist, projectPointOnSegment, pointInPolygon, polygonCentroid, fitViewBoxToElements, wrapTextLines } from "./geometry.js";
import { NumField, TypeSelect, ConditionSelect, PhaseToggles } from "./ElementRows.jsx";

// Split out of App.jsx — this is the Croqui (2D sketch) editor, the
// single largest component in the app. Its own private geometry helpers
// (nearestParallelWallDims, traceEnclosedRoom, the RDP simplifiers,
// findMergeableWall/mergeWallPair) live below, unexported, since nothing
// else in the app needs them.

// lucide-react has no "stairs" icon — a small hand-drawn one, same stroke
// style (currentColor, round caps/joins) as the rest so it blends in.
function StairsIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4v-4h4v-4h4v-4h4" />
      <path d="M4 20V4" />
    </svg>
  );
}

// lucide-react also has no "building window" icon — Blinds reads as
// horizontal slats at 16px, not a window. A framed pane with a cross of
// mullions plus a sill reads unambiguously as a window instead.
function WindowIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="4" width="14" height="15" rx="1" />
      <path d="M12 4v15M5 11.5h14" />
      <path d="M3 20h18" />
    </svg>
  );
}

// For each wall, finds the nearest parallel wall facing it on each side
// (overlapping projection along its own axis) and returns one dimension
// line per such pair — the "cota" between opposing wall faces (e.g. room
// width/depth), independent of each wall's own length label.
function nearestParallelWallDims(walls) {
  const pairs = [];
  for (let i = 0; i < walls.length; i++) {
    const a = walls[i];
    const ax = a.x2 - a.x1, ay = a.y2 - a.y1;
    const alen = Math.hypot(ax, ay);
    if (alen < 1e-6) continue;
    const ux = ax / alen, uy = ay / alen;
    const nx = -uy, ny = ux;
    let bestPos = null, bestNeg = null;
    for (let j = 0; j < walls.length; j++) {
      if (i === j) continue;
      const b = walls[j];
      const bx = b.x2 - b.x1, by = b.y2 - b.y1;
      const blen = Math.hypot(bx, by);
      if (blen < 1e-6) continue;
      if (Math.abs(ax * by - ay * bx) / (alen * blen) > 0.02) continue; // not parallel (~1° tolerance)
      const bmx = (b.x1 + b.x2) / 2, bmy = (b.y1 + b.y2) / 2;
      const signedDist = (bmx - a.x1) * nx + (bmy - a.y1) * ny;
      const distPx = Math.abs(signedDist);
      if (distPx < GRID * 0.6) continue; // too close to be a separate facing wall
      const projB1 = (b.x1 - a.x1) * ux + (b.y1 - a.y1) * uy;
      const projB2 = (b.x2 - a.x1) * ux + (b.y2 - a.y1) * uy;
      const overlapMin = Math.max(0, Math.min(projB1, projB2));
      const overlapMax = Math.min(alen, Math.max(projB1, projB2));
      if (overlapMax - overlapMin < GRID * 0.5) continue;
      const cand = { wallId: b.id, distPx, signedDist, overlapMin, overlapMax };
      if (signedDist > 0 && (!bestPos || distPx < bestPos.distPx)) bestPos = cand;
      if (signedDist < 0 && (!bestNeg || distPx < bestNeg.distPx)) bestNeg = cand;
    }
    for (const cand of [bestPos, bestNeg]) {
      if (!cand) continue;
      const midT = (cand.overlapMin + cand.overlapMax) / 2;
      const p1 = { x: a.x1 + ux * midT, y: a.y1 + uy * midT };
      const p2 = { x: p1.x + nx * cand.signedDist, y: p1.y + ny * cand.signedDist };
      pairs.push({ aId: a.id, bId: cand.wallId, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, distPx: cand.distPx, overlapMin: cand.overlapMin, overlapMax: cand.overlapMax });
    }
  }
  const seen = new Set();
  const out = [];
  for (const p of pairs) {
    const key = [p.aId, p.bId].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
// Auto-traces a room polygon by flood-filling the open floor area starting
// from a clicked point, stopping at wall faces — the "click inside" room
// tool, as opposed to tracing each corner by hand. Works on a grid finer
// than the drawing's own snap grid so it can still approximate diagonal
// walls reasonably well. Returns null when the click landed on a wall, the
// grid got unreasonably large, or the area isn't actually enclosed (the
// fill reaches the padding border around the walls' bounding box).
function traceEnclosedRoom(walls, clickPoint, GRID, scale) {
  if (!walls.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  walls.forEach(w => {
    minX = Math.min(minX, w.x1, w.x2); maxX = Math.max(maxX, w.x1, w.x2);
    minY = Math.min(minY, w.y1, w.y2); maxY = Math.max(maxY, w.y1, w.y2);
  });
  const spanX = maxX - minX, spanY = maxY - minY;
  // CELL is expressed in drawing units, but what it actually costs the
  // room is real-world size: at a coarse "meters per grid square" scale
  // (a big property surveyed with a loose grid), a fixed-in-units cell
  // can represent a meter or more — bigger than the entire width of a
  // narrow room like a hallway or a tapering tip, so the wall-blocking
  // margin on both sides overlaps and blots out the whole interior
  // there. Aim for a roughly constant ~8cm real-world cell instead of a
  // fixed drawing-unit one. A single fixed floor on how fine that's
  // allowed to get (rather than one derived from the cell-count budget
  // below) was still too coarse for a small, narrow room like this one,
  // while being needlessly fine for a huge one — so shrink CELL only as
  // far as this room's OWN bounding box can afford within the cap,
  // which lets a small room get a much finer cell than a large one.
  let CELL = Math.min(GRID / 2, scale ? (0.08 / scale) * GRID : GRID / 2);
  for (let i = 0; i < 30 && CELL < GRID / 2; i++) {
    const pad = CELL * 4;
    const cols = Math.ceil((spanX + 2 * pad) / CELL);
    const rows = Math.ceil((spanY + 2 * pad) / CELL);
    if (cols * rows <= 40000) break;
    CELL *= 1.25;
  }
  CELL = Math.min(GRID / 2, CELL);
  const PAD = CELL * 4;
  minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;
  const cols = Math.ceil((maxX - minX) / CELL);
  const rows = Math.ceil((maxY - minY) / CELL);
  if (cols * rows > 40000 || cols < 1 || rows < 1) return null;

  const blocked = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const px = minX + (cx + 0.5) * CELL, py = minY + (cy + 0.5) * CELL;
      for (const w of walls) {
        const proj = projectPointOnSegment({ x: px, y: py }, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
        // Only a thin safety margin here (not half a cell, as before) — the
        // flood fill below is already 4-connected, which on its own can't
        // leak diagonally through a wall corner (that needs 8-connectivity),
        // so a big margin wasn't actually buying leak-proofing; it was just
        // eating into the traced room on every side, undercounting its area
        // by roughly one margin-width per wall (visibly so once CELL isn't
        // tiny — e.g. ~4cm inset each side at the default ~8cm cell).
        if (dist({ x: px, y: py }, proj) < w.halfThickPx + CELL * 0.12) {
          blocked[cy * cols + cx] = 1;
          break;
        }
      }
    }
  }

  const startCx = Math.floor((clickPoint.x - minX) / CELL);
  const startCy = Math.floor((clickPoint.y - minY) / CELL);
  if (startCx < 0 || startCy < 0 || startCx >= cols || startCy >= rows) return null;
  if (blocked[startCy * cols + startCx]) return null;

  const filled = new Uint8Array(cols * rows);
  const stack = [[startCx, startCy]];
  filled[startCy * cols + startCx] = 1;
  let touchedEdge = false;
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx === 0 || cy === 0 || cx === cols - 1 || cy === rows - 1) touchedEdge = true;
    const neighbors = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const idx = ny * cols + nx;
      if (filled[idx] || blocked[idx]) continue;
      filled[idx] = 1;
      stack.push([nx, ny]);
    }
  }
  if (touchedEdge) return null;

  const isFilled = (cx, cy) => cx >= 0 && cy >= 0 && cx < cols && cy < rows && filled[cy * cols + cx];
  const edges = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!filled[cy * cols + cx]) continue;
      const tl = { x: minX + cx * CELL, y: minY + cy * CELL };
      const tr = { x: minX + (cx + 1) * CELL, y: minY + cy * CELL };
      const bl = { x: minX + cx * CELL, y: minY + (cy + 1) * CELL };
      const br = { x: minX + (cx + 1) * CELL, y: minY + (cy + 1) * CELL };
      if (!isFilled(cx, cy - 1)) edges.push([tr, tl]);
      if (!isFilled(cx, cy + 1)) edges.push([bl, br]);
      if (!isFilled(cx - 1, cy)) edges.push([tl, bl]);
      if (!isFilled(cx + 1, cy)) edges.push([br, tr]);
    }
  }
  if (!edges.length) return null;

  const keyOf = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  const byStart = new Map();
  edges.forEach(e => byStart.set(keyOf(e[0]), e));

  const startEdge = edges[0];
  const loop = [startEdge[0]];
  let cur = startEdge[1];
  let guard = 0;
  while (keyOf(cur) !== keyOf(startEdge[0]) && guard < edges.length + 5) {
    loop.push(cur);
    const next = byStart.get(keyOf(cur));
    if (!next) return null;
    cur = next[1];
    guard++;
  }
  if (guard >= edges.length + 5) return null;

  // The raster trace above approximates any non-orthogonal wall as a
  // staircase of CELL-sized steps (each cell is either "in" or "out" of
  // the room) — an exactly-collinear-point filter only cleans up straight
  // runs, so a diagonal or acute-angled wall still comes out looking like
  // a jagged staircase instead of one straight edge. Running it through
  // Ramer-Douglas-Peucker flattens any deviation up to a bit more than
  // one step back into a straight line, while real corners (offset by
  // whole wall thicknesses/segments) stay well outside that tolerance
  // and survive.
  const smoothed = rdpSimplifyClosed(loop, CELL * 1.5);
  const finalLoop = smoothed.length >= 3 ? smoothed : loop;
  // The raster trace, even after RDP smoothing, still only approximates
  // each wall's real face — it's built from CELL-sized steps offset by the
  // fill-blocking margin above, so every edge sits some fraction of a cell
  // shy of where the wall's actual face is, undercounting the room's area
  // by a small but visible amount (worse the smaller the room, since CELL
  // itself is a bigger fraction of it). Re-snapping each edge onto the
  // wall it's actually tracing — using the wall's own geometry, not the
  // raster — removes that error instead of just shrinking it further.
  return snapRoomToWallFaces(finalLoop, walls, CELL * 2.5);
}
// Replaces each edge of a raster-traced room outline with the EXACT face
// line of whichever wall it's tracing (a line parallel to that wall's
// centerline, offset by precisely its own half-thickness), then rebuilds
// each corner as the intersection of its two adjacent corrected edges —
// turning the raster's blocky approximation into the true wall-face
// polygon, independent of CELL size. Falls back to the original raster
// edge/vertex wherever no wall match is found or two adjacent edges turn
// out (near-)parallel, so a partial or ambiguous match never makes the
// result worse than the untouched raster trace.
function snapRoomToWallFaces(loop, walls, tolerance) {
  const n = loop.length;
  if (n < 3) return loop;
  const faceLines = loop.map((p1, i) => {
    const p2 = loop[(i + 1) % n];
    const ex = p2.x - p1.x, ey = p2.y - p1.y, elen = Math.hypot(ex, ey);
    if (elen < 1e-6) return null;
    const eux = ex / elen, euy = ey / elen;
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    let best = null;
    for (const w of walls) {
      const wx = w.x2 - w.x1, wy = w.y2 - w.y1, wlen = Math.hypot(wx, wy) || 1;
      const wux = wx / wlen, wuy = wy / wlen;
      if (Math.abs(eux * wuy - euy * wux) > 0.03) continue; // not parallel to this wall
      const proj = projectPointOnSegment(mid, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
      const nx = -wuy, ny = wux;
      const signedDist = (mid.x - proj.x) * nx + (mid.y - proj.y) * ny;
      const diff = Math.abs(Math.abs(signedDist) - w.halfThickPx);
      if (diff < tolerance && (!best || diff < best.diff)) {
        best = { diff, ux: wux, uy: wuy, nx, ny, footpoint: proj, sign: signedDist >= 0 ? 1 : -1, halfThickPx: w.halfThickPx };
      }
    }
    if (!best) return null;
    return {
      ux: best.ux, uy: best.uy,
      point: { x: best.footpoint.x + best.nx * best.sign * best.halfThickPx, y: best.footpoint.y + best.ny * best.sign * best.halfThickPx },
    };
  });
  return loop.map((p, i) => {
    const prev = faceLines[(i - 1 + n) % n];
    const cur = faceLines[i];
    if (!prev || !cur) return p;
    const denom = prev.ux * cur.uy - prev.uy * cur.ux;
    if (Math.abs(denom) < 1e-6) return p;
    const t = ((cur.point.x - prev.point.x) * cur.uy - (cur.point.y - prev.point.y) * cur.ux) / denom;
    return { x: prev.point.x + prev.ux * t, y: prev.point.y + prev.uy * t };
  });
}
function perpDistToLine(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return dist(p, a);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}
function rdpOpen(points, epsilon) {
  if (points.length < 3) return points.slice();
  const first = points[0], last = points[points.length - 1];
  let maxD = -1, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistToLine(points[i], first, last);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > epsilon) {
    const left = rdpOpen(points.slice(0, idx + 1), epsilon);
    const right = rdpOpen(points.slice(idx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}
// RDP is defined for an open polyline with two fixed endpoints; a closed
// room outline has none, so split it into two chains at the point
// farthest from an arbitrary anchor (loop[0]) and simplify each as an
// open path, then stitch them back into one loop.
function rdpSimplifyClosed(loop, epsilon) {
  if (loop.length < 4) return loop;
  let maxD = 0, splitIdx = 1;
  for (let i = 1; i < loop.length; i++) {
    const d = dist(loop[0], loop[i]);
    if (d > maxD) { maxD = d; splitIdx = i; }
  }
  const chainA = loop.slice(0, splitIdx + 1);
  const chainB = loop.slice(splitIdx).concat([loop[0]]);
  const simpA = rdpOpen(chainA, epsilon);
  const simpB = rdpOpen(chainB, epsilon);
  return simpA.slice(0, -1).concat(simpB.slice(0, -1));
}
function findMergeableWall(wall, elements) {
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const others = elements.filter(e => e.type === "wall" && e.id !== wall.id);
  for (const o of others) {
    const sharedAtStart = dist({ x: o.x1, y: o.y1 }, { x: wall.x1, y: wall.y1 }) < 3 || dist({ x: o.x2, y: o.y2 }, { x: wall.x1, y: wall.y1 }) < 3;
    const sharedAtEnd = dist({ x: o.x1, y: o.y1 }, { x: wall.x2, y: wall.y2 }) < 3 || dist({ x: o.x2, y: o.y2 }, { x: wall.x2, y: wall.y2 }) < 3;
    if (!sharedAtStart && !sharedAtEnd) continue;
    const odx = o.x2 - o.x1, ody = o.y2 - o.y1, olen = Math.hypot(odx, ody) || 1;
    const oux = odx / olen, ouy = ody / olen;
    if (Math.abs(ux * ouy - uy * oux) < 0.06) return o;
  }
  return null;
}
function mergeWallPair(a, b) {
  const pts = [{ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }, { x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }];
  let best = [pts[0], pts[1]], bestD = -1;
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { const d = dist(pts[i], pts[j]); if (d > bestD) { bestD = d; best = [pts[i], pts[j]]; } }
  return { x1: best[0].x, y1: best[0].y, x2: best[1].x, y2: best[1].y };
}
// Finds a nearby, non-parallel wall whose nearest endpoint to one of
// `wall`'s own endpoints sits close by but doesn't already coincide with
// it — the "meant to be the same corner, but one wall was drawn a bit
// short/long or they cross past each other" case that's fiddly to fix by
// dragging a single endpoint by hand. Parallel/collinear walls are left
// to the merge feature above — there's no single corner to trim to.
function findCornerWall(wall, elements) {
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const aEnds = [{ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }];
  const others = elements.filter(e => e.type === "wall" && e.id !== wall.id);
  for (const o of others) {
    const odx = o.x2 - o.x1, ody = o.y2 - o.y1, olen = Math.hypot(odx, ody) || 1;
    const oux = odx / olen, ouy = ody / olen;
    if (Math.abs(ux * ouy - uy * oux) < 0.06) continue;
    const bEnds = [{ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }];
    for (const ae of aEnds) for (const be of bEnds) {
      const d = dist(ae, be);
      if (d > 0.75 && d < GRID * 3) return o;
    }
  }
  return null;
}
// Extends/trims two non-parallel walls so they meet exactly at the
// intersection of their (infinite) centerlines — whichever endpoint of
// each wall already sits nearest that point is the one pulled onto it,
// same as dragging that single endpoint by hand, just exact. The other,
// already-anchored end of each wall never moves.
function trimWallsToCorner(a, b) {
  const aux0 = a.x2 - a.x1, auy0 = a.y2 - a.y1, alen = Math.hypot(aux0, auy0) || 1;
  const aux = aux0 / alen, auy = auy0 / alen;
  const bux0 = b.x2 - b.x1, buy0 = b.y2 - b.y1, blen = Math.hypot(bux0, buy0) || 1;
  const bux = bux0 / blen, buy = buy0 / blen;
  const denom = aux * buy - auy * bux;
  if (Math.abs(denom) < 1e-6) return null;
  const t = ((b.x1 - a.x1) * buy - (b.y1 - a.y1) * bux) / denom;
  const ix = a.x1 + aux * t, iy = a.y1 + auy * t;
  const aStartD = dist({ x: a.x1, y: a.y1 }, { x: ix, y: iy });
  const aEndD = dist({ x: a.x2, y: a.y2 }, { x: ix, y: iy });
  const bStartD = dist({ x: b.x1, y: b.y1 }, { x: ix, y: iy });
  const bEndD = dist({ x: b.x2, y: b.y2 }, { x: ix, y: iy });
  return {
    a: aStartD <= aEndD ? { x1: ix, y1: iy, x2: a.x2, y2: a.y2 } : { x1: a.x1, y1: a.y1, x2: ix, y2: iy },
    b: bStartD <= bEndD ? { x1: ix, y1: iy, x2: b.x2, y2: b.y2 } : { x1: b.x1, y1: b.y1, x2: ix, y2: iy },
  };
}

export default function VectorSketch({ level, allLevels, rooms, onChange, onMeta, onNameRoom, onMergeWalls, onLinkStairLevel }) {
  const svgRef = useRef(null);
  const [tool, setTool] = useState("selecionar");
  const [planMode, setPlanMode] = useState("piso");
  const [pending, setPending] = useState(null);
  const [polygon, setPolygon] = useState([]);
  const [ambienteAuto, setAmbienteAuto] = useState(true);
  const [lastPolygonAdd, setLastPolygonAdd] = useState(1);
  const [autoRoomMsg, setAutoRoomMsg] = useState("");
  const [dims, setDims] = useState({ w: 340, h: 300 });
  const [vb, setVb] = useState(null);
  const [deletedStack, setDeletedStack] = useState([]);
  const [history, setHistory] = useState([]);
  const isDraggingRef = useRef(false);
  const [namingId, setNamingId] = useState(null);
  const [namingValue, setNamingValue] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [showBelow, setShowBelow] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showAbove, setShowAbove] = useState(false);
  const [draggingLabel, setDraggingLabel] = useState(null);
  const [draggingDimLabel, setDraggingDimLabel] = useState(null);
  const [editingDim, setEditingDim] = useState(null);
  const [editingWallLen, setEditingWallLen] = useState(null);
  const [editingLumDim, setEditingLumDim] = useState(null);
  const [editingParallelDim, setEditingParallelDim] = useState(null);
  const [dragSession, setDragSession] = useState(null);
  const [splittingWall, setSplittingWall] = useState(null);
  const pinch = useRef(null);
  const scale = toNum(level.sketchScale, 0.5);
  const wallHeightDefault = level.wallHeightDefault || "2.80";
  const dimColor = level.dimColor || "#4A4A46";
  const elements = level.sketchElements || [];
  const wallsById = {};
  elements.filter(e => e.type === "wall").forEach(w => { wallsById[w.id] = w; });
  const selected = elements.find(e => e.id === selectedId) || null;

  const levelIdx = (allLevels || []).findIndex(l => l.id === level.id);
  const belowLevel = levelIdx > 0 ? allLevels[levelIdx - 1] : null;
  const aboveLevel = (allLevels && levelIdx >= 0 && levelIdx < allLevels.length - 1) ? allLevels[levelIdx + 1] : null;

  useLayoutEffect(() => {
    function measure() {
      if (!svgRef.current) return;
      const w = svgRef.current.parentElement.clientWidth || 340;
      const svgTop = svgRef.current.getBoundingClientRect().top;
      const nav = document.querySelector("[data-braves-bottom-nav]");
      const bottomEdge = nav ? nav.getBoundingClientRect().top : (window.innerHeight || 700);
      // Space that always follows the canvas (the Recente/Desfazer/Tudo row) —
      // reserved so it's never pushed past the visible viewport, which used
      // to trap it behind the canvas's own touch-none drawing surface.
      const BELOW_CANVAS_RESERVED = 64;
      const h = Math.max(220, bottomEdge - svgTop - BELOW_CANVAS_RESERVED);
      setDims(prev => (Math.abs(prev.w - w) > 1 || Math.abs(prev.h - h) > 1) ? { w, h } : prev);
      setVb(v => v || fitViewBoxToElements(elements, w, h));
    }
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [tool, planMode, editingDim, editingWallLen, editingParallelDim, namingId, showBelow, showAbove, belowLevel, aboveLevel]);

  const viewBox = vb || { x: 0, y: 0, w: dims.w, h: dims.h };

  function toScreen(p) {
    const rect = svgRef.current.getBoundingClientRect();
    return { x: ((p.x - viewBox.x) / viewBox.w) * rect.width, y: ((p.y - viewBox.y) / viewBox.h) * rect.height };
  }
  function svgPointRaw(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    const relX = (p.clientX - rect.left) / rect.width;
    const relY = (p.clientY - rect.top) / rect.height;
    return { x: viewBox.x + relX * viewBox.w, y: viewBox.y + relY * viewBox.h };
  }
  function pxToMeters(px) { return +((px / GRID) * scale).toFixed(2); }
  // Every discrete action (add, delete, edit a length, close a room...)
  // snapshots the pre-change elements onto a real undo history. A drag
  // gesture calls this on every pointer move, though — snapshotting each
  // of those would flood history with intermediate frames of the same
  // drag, so beginDrag* takes the one snapshot for the whole gesture
  // up front (via pushHistory) and sets isDraggingRef so this skips its
  // own auto-push until the drag ends.
  function pushHistory() {
    setHistory(h => {
      const next = [...h, elements];
      return next.length > 60 ? next.slice(next.length - 60) : next;
    });
  }
  function commitElements(next) {
    if (!isDraggingRef.current) pushHistory();
    onChange(next);
  }
  function patchSelected(patch) { if (!selectedId) return; commitElements(elements.map(e => e.id === selectedId ? { ...e, ...patch } : e)); }

  function zoomAround(relX, relY, factor) {
    setVb(v => {
      const cur = v || { x: 0, y: 0, w: dims.w, h: dims.h };
      const newW = Math.min(4000, Math.max(60, cur.w * factor));
      const newH = newW * (cur.h / cur.w);
      const cx = cur.x + relX * cur.w, cy = cur.y + relY * cur.h;
      return { x: cx - relX * newW, y: cy - relY * newH, w: newW, h: newH };
    });
  }
  function elementAnchor(el) {
    if (!el) return null;
    if (el.type === "wall" || el.type === "stair") return { x: (el.x1 + el.x2) / 2, y: (el.y1 + el.y2) / 2 };
    if (el.type === "door" || el.type === "window" || el.type === "luminaria") return { x: el.x, y: el.y };
    if (el.type === "room") return polygonCentroid(el.points);
    return null;
  }
  function zoomButton(factor) {
    const anchor = elementAnchor(selected);
    if (anchor) {
      setVb(v => {
        const cur = v || { x: 0, y: 0, w: dims.w, h: dims.h };
        const newW = Math.min(4000, Math.max(60, cur.w * factor));
        const newH = newW * (cur.h / cur.w);
        return { x: anchor.x - newW / 2, y: anchor.y - newH / 2, w: newW, h: newH };
      });
      return;
    }
    zoomAround(0.5, 0.5, factor);
  }
  function resetZoom() {
    setVb(fitViewBoxToElements(elements, dims.w, dims.h));
  }
  function ensureVisible(x, y) {
    if (!isFinite(x) || !isFinite(y)) return;
    setVb(v => {
      const cur = v || { x: 0, y: 0, w: dims.w, h: dims.h };
      const margin = cur.w * 0.18;
      if (x < cur.x + margin || x > cur.x + cur.w - margin || y < cur.y + margin || y > cur.y + cur.h - margin) {
        return { x: x - cur.w / 2, y: y - cur.h / 2, w: cur.w, h: cur.h };
      }
      return cur;
    });
  }
  function onWheel(e) {
    e.preventDefault();
    const rect = svgRef.current.getBoundingClientRect();
    zoomAround((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, e.deltaY > 0 ? 1.12 : 0.89);
  }
  function onTouchStartCanvas(e) {
    if (e.touches.length === 2) {
      // A second finger arriving always means "pinch now", even if the
      // first one had already grabbed a wall/endpoint/opening — otherwise
      // that stale drag session can make the element jump once fingers
      // start lifting back to a single touch.
      setDragSession(null);
      const [a, b] = e.touches;
      pinch.current = { d: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY), vb: viewBox };
    }
  }
  function onTouchMoveCanvas(e) {
    if (e.touches.length === 2 && pinch.current) {
      if (e.cancelable) e.preventDefault();
      const [a, b] = e.touches;
      const d = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      const factor = pinch.current.d / Math.max(1, d);
      const startVb = pinch.current.vb;
      const newW = Math.min(4000, Math.max(60, startVb.w * factor));
      const newH = newW * (startVb.h / startVb.w);
      const cx = startVb.x + startVb.w / 2, cy = startVb.y + startVb.h / 2;
      setVb({ x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH });
      return;
    }
    if (e.touches.length === 1 && (dragSession || draggingLabel || draggingDimLabel)) onCanvasPointerMove(e);
  }
  function onTouchEndCanvas(e) { if (e.touches.length < 2) pinch.current = null; if (e.touches.length === 0) onCanvasPointerUp(); }

  function nearestWall(p) {
    const walls = elements.filter(el => el.type === "wall");
    if (!walls.length) return null;
    const candidates = walls.map(w => {
      const proj = projectPointOnSegment(p, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
      return { wall: w, proj, d: dist(p, proj), len: dist({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }) };
    }).sort((a, b) => a.d - b.d);
    const screenPxTolerance = 16;
    const worldTolerance = screenPxTolerance * (viewBox.w / dims.w);
    const near = candidates.filter(c => c.d <= candidates[0].d + worldTolerance);
    near.sort((a, b) => a.len - b.len);
    return { wall: near[0].wall, proj: near[0].proj };
  }
  // Like nearestWall, but with a real cutoff distance instead of always
  // returning the closest wall no matter how far — used to decide whether
  // a tap actually landed on a wall at all (see ambiente's "tap a wall to
  // add both its ends" below), not just to attach an opening to one.
  function nearestWallWithinTolerance(p, screenPxTolerance = 16) {
    const walls = elements.filter(el => el.type === "wall");
    if (!walls.length) return null;
    let best = null, bestD = Infinity;
    walls.forEach(w => {
      const proj = projectPointOnSegment(p, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
      const d = dist(p, proj);
      if (d < bestD) { bestD = d; best = { wall: w, proj }; }
    });
    const worldTolerance = screenPxTolerance * (viewBox.w / dims.w);
    return best && bestD <= worldTolerance ? best : null;
  }
  // Finds an existing wall/stair endpoint within tolerance so two segments
  // can be made to share an exact point (closing a shape) even when that
  // point doesn't land on a grid intersection — angled walls in particular
  // rarely meet the grid exactly. Returns null (not a fallback point) when
  // nothing is close, so callers can still try angle-snapping first.
  function findNearbyEndpoint(p, excludeWallId, excludeIds) {
    // Expressed as a screen-pixel radius, not a fixed world-space one — a
    // fixed SVG-unit tolerance is tied to the drawing's real-world scale,
    // so two corners genuinely closer together than it (like either end of
    // a 0.57m wall) could never be told apart no matter how far the user
    // zoomed in. Converting from screen pixels means zooming in actually
    // buys more precision, same as any CAD tool.
    const screenPxTolerance = 14;
    const TOL = screenPxTolerance * (viewBox.w / dims.w);
    let best = null, bestD = TOL;
    elements.forEach(e => {
      if (e.type !== "wall" && e.type !== "stair") return;
      if (e.id === excludeWallId) return;
      if (excludeIds && excludeIds.has(e.id)) return;
      [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }].forEach(pt => {
        const d = dist(p, pt);
        if (d < bestD) { bestD = d; best = pt; }
      });
    });
    return best;
  }
  // Snaps freePt's angle relative to fixedPt to the nearest 45° step
  // whenever it's already close — the same "ortho" nudge any CAD sketch
  // tool needs, since a freehand drag on a touchscreen essentially never
  // lands on an exactly horizontal/vertical/diagonal angle on its own.
  // Closeness is judged by the actual sideways (perpendicular) pixel
  // deviation at the current drag distance, not by the angle alone — a
  // fixed angular tolerance is razor-thin on a short wall but enormous
  // (impossible to pull free of) on a long one, since the same few degrees
  // sweep a much bigger sideways distance the farther out you are.
  function angleSnap(fixedPt, freePt, pixelTol = 10) {
    const dx = freePt.x - fixedPt.x, dy = freePt.y - fixedPt.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return freePt;
    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 4;
    const nearest = Math.round(angle / step) * step;
    const perpDeviation = Math.abs(Math.sin(angle - nearest)) * d;
    if (perpDeviation > pixelTol) return freePt;
    return { x: fixedPt.x + Math.cos(nearest) * d, y: fixedPt.y + Math.sin(nearest) * d };
  }
  function findAt(p) {
    const dw = elements.filter(e => e.type === "door" || e.type === "window" || e.type === "luminaria");
    let best = null, bestD = Infinity;
    dw.forEach(e => { const d = dist(p, { x: e.x, y: e.y }); if (d < bestD) { bestD = d; best = e; } });
    if (best && bestD < 18) return best;
    const walls = elements.filter(e => e.type === "wall" || e.type === "stair");
    let bestWall = null, bestWD = Infinity;
    walls.forEach(w => {
      const proj = projectPointOnSegment(p, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
      const d = dist(p, proj);
      if (d < bestWD) { bestWD = d; bestWall = w; }
    });
    if (bestWall && bestWD < 16) return bestWall;
    const roomPolys = elements.filter(e => e.type === "room");
    const hitRoom = roomPolys.find(r => pointInPolygon(p, r.points));
    if (hitRoom) return hitRoom;
    return null;
  }

  function handleTap(e) {
    if (e.touches && e.touches.length > 1) return;
    if (draggingLabel || draggingDimLabel) return;
    e.preventDefault();
    // Must be the true unsnapped pointer position, not svgPoint()'s
    // grid-snapped one — findNearbyEndpoint below does its own
    // fine-grained (screen-pixel) search, and pre-rounding the input to
    // the 20-unit grid first can throw away more precision than that
    // search tolerance, silently pulling the match onto the wrong corner
    // whenever two corners (or a short wall's own two ends) sit closer
    // together than the grid step.
    const rawP = svgPointRaw(e);
    // Ambiente needs this too — its polygon vertices are meant to trace
    // existing wall corners, and missing them by a few px (same issue
    // walls had) leaves gaps that never actually close the shape.
    let p = rawP;
    if (tool === "parede" || tool === "escada" || tool === "ambiente") {
      const endpointHit = findNearbyEndpoint(rawP, null);
      p = endpointHit || { x: snap(rawP.x), y: snap(rawP.y) };
      // A freehand second tap almost never lands on an exact 0/45/90°
      // angle from the first point — nudge it there when it's already
      // close, so walls stay orthogonal instead of drifting off-angle.
      if (!endpointHit && pending && (tool === "parede" || tool === "escada")) p = angleSnap(pending, p);
    }

    if (tool === "selecionar") { const hit = findAt(p); setSelectedId(hit ? hit.id : null); return; }

    if (tool === "apagar") {
      const target = findAt(p);
      if (!target) return;
      let batch = [target];
      if (target.type === "wall") {
        const attached = elements.filter(el => (el.type === "door" || el.type === "window") && el.wallId === target.id);
        batch = [target, ...attached];
      }
      const ids = new Set(batch.map(b => b.id));
      setDeletedStack(s => [...s, batch]);
      if (selectedId && ids.has(selectedId)) setSelectedId(null);
      commitElements(elements.filter(el => !ids.has(el.id)));
      return;
    }

    if (tool === "parede") {
      if (!pending) { setPending(p); return; }
      if (p.x === pending.x && p.y === pending.y) { setPending(null); return; }
      const length = pxToMeters(dist(pending, p));
      const wallCount = elements.filter(x => x.type === "wall").length;
      const el = { id: uid(), type: "wall", x1: pending.x, y1: pending.y, x2: p.x, y2: p.y, tag: `P-${wallCount + 1}`, length, height: wallHeightDefault, wallType: WALL_TYPES[0], finishA: "A definir", paintColorA: "#E8E4DA", finishB: "A definir", paintColorB: "#E8E4DA", condition: "A confirmar", demolir: false, construir: false };
      commitElements([...elements, el]);
      // Chain mode: keep drawing from this wall's endpoint instead of
      // requiring a fresh start tap for every segment. Tap the same point
      // again (or reselect the Parede tool) to end the chain.
      setPending(p);
      return;
    }

    if (tool === "escada") {
      if (!pending) { setPending(p); return; }
      if (p.x === pending.x && p.y === pending.y) { setPending(null); return; }
      const count = elements.filter(x => x.type === "stair").length;
      const el = { id: uid(), type: "stair", x1: pending.x, y1: pending.y, x2: p.x, y2: p.y, tag: `ES-${count + 1}`, toLevelId: aboveLevel?.id || "", width: 1.0, condition: "A confirmar" };
      commitElements([...elements, el]);
      setPending(null);
      setSelectedId(el.id);
      return;
    }

    if (tool === "luminaria") {
      const raw = svgPointRaw(e);
      const count = elements.filter(x => x.type === "luminaria").length;
      const el = { id: uid(), type: "luminaria", x: raw.x, y: raw.y, tag: `LM-${count + 1}` };
      commitElements([...elements, el]);
      setSelectedId(el.id);
      return;
    }

    if (tool === "ambiente") {
      if (polygon.length === 0) {
        const hitExisting = elements.find(e => e.type === "room" && pointInPolygon(p, e.points));
        if (hitExisting) {
          if (planMode === "forro") { setSelectedId(hitExisting.id); return; }
          setNamingId(hitExisting.id); setNamingValue(hitExisting.name || "");
          return;
        }
      }
      if (planMode === "forro") return;
      if (ambienteAuto && polygon.length === 0) {
        setAutoRoomMsg("");
        const wallSegs = elements.filter(e => e.type === "wall").map(w => ({
          x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2,
          halfThickPx: (wallThicknessM(w.wallType) / 2 / scale) * GRID,
        }));
        // Use the raw tap position, not the endpoint-snapped p — snapping
        // this click onto a nearby wall corner (meant for tracing exact
        // vertices, not for "click somewhere inside the room") could land
        // it right on/against a wall, starting the flood fill from a
        // sliver cell instead of the room's actual open interior.
        const traced = traceEnclosedRoom(wallSegs, rawP, GRID, scale);
        if (!traced) {
          setAutoRoomMsg("Não achei um contorno fechado aqui — verifique se as paredes se encontram, ou desenhe os pontos manualmente.");
          return;
        }
        let area = 0;
        for (let i = 0; i < traced.length; i++) {
          const a = traced[i], b = traced[(i + 1) % traced.length];
          area += a.x * b.y - b.x * a.y;
        }
        area = Math.abs(area / 2);
        const areaM2 = +((area / (GRID * GRID)) * scale * scale).toFixed(2);
        const el = { id: uid(), type: "room", points: traced, area: areaM2, roomId: null, floorFinish: "A definir", floorColor: "#D9D4C8", ceilingFinish: "A definir" };
        commitElements([...elements, el]);
        setNamingId(el.id); setNamingValue("");
        // Placing a room is a one-shot action, not a mode you stay in —
        // leaving "tool" on "ambiente" afterward silently disabled every
        // wall dimension (editable/draggable only in "selecionar") right
        // when the user is most likely to want to check/adjust them.
        setTool("selecionar");
        return;
      }
      // Tapping precisely on a very short wall's own corner is genuinely
      // hard even zoomed in (the two ends can be just a handful of screen
      // px apart) — short enough that the shared endpoint-snap above
      // (endpointHit) almost always already resolves the tap to whichever
      // end is nearest, before this code ever sees it. So this can't
      // gate on "wasn't already an exact endpoint": for a wall shorter
      // than about twice that snap tolerance, EVERY tap on it resolves
      // to one end or the other, and the shortcut below would never
      // fire when it's needed most. Instead, always check for a nearby
      // wall LINE first and add whichever of its two ends aren't already
      // traced — falling back to a single free point only when no wall
      // is close enough at all.
      {
        const wallHit = nearestWallWithinTolerance(rawP);
        if (wallHit) {
          const w = wallHit.wall;
          const ends = [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }];
          const ref = polygon.length ? polygon[polygon.length - 1] : rawP;
          ends.sort((a, b) => dist(ref, a) - dist(ref, b));
          // A tapped corner is often shared by two walls (a T-junction or
          // the room's own closing corner) and which one comes back as
          // "nearest" can flip on sub-pixel differences — so rather than
          // only checking the wall's near end against the polygon's last
          // point, drop ANY end that's already traced anywhere in the
          // polygon (its far end could just as easily be a point placed
          // several taps ago, not only the immediately previous one).
          const toAdd = ends.filter(e => !polygon.some(q => dist(q, e) < 1));
          if (toAdd.length) {
            setLastPolygonAdd(toAdd.length);
            setPolygon([...polygon, ...toAdd]);
          }
          return;
        }
      }
      setLastPolygonAdd(1);
      setPolygon([...polygon, p]);
      return;
    }

    if (tool === "porta" || tool === "janela") {
      const hit = nearestWall(p);
      if (!hit) return;
      const type = tool === "porta" ? "door" : "window";
      const count = elements.filter(x => x.type === type).length;
      const tagPrefix = tool === "porta" ? "PT" : "JN";
      const el = tool === "porta"
        ? { id: uid(), type, x: hit.proj.x, y: hit.proj.y, wallId: hit.wall.id, tag: `${tagPrefix}-${count + 1}`, width: 0.8, height: 2.10, doorType: DOOR_TYPES[0], panels: 1, condition: "A confirmar", demolir: false, construir: false }
        : { id: uid(), type, x: hit.proj.x, y: hit.proj.y, wallId: hit.wall.id, tag: `${tagPrefix}-${count + 1}`, width: 1.2, height: 1.20, peitoril: 1.00, windowType: WINDOW_TYPES[0], panels: 2, condition: "A confirmar", demolir: false, construir: false };
      commitElements([...elements, el]);
      setSelectedId(el.id);
    }
  }

  function restoreLast() {
    if (!deletedStack.length) return;
    const batch = deletedStack[deletedStack.length - 1];
    setDeletedStack(s => s.slice(0, -1));
    commitElements([...elements, ...batch]);
  }

  function closePolygon() {
    if (polygon.length < 3) return;
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      area += a.x * b.y - b.x * a.y;
    }
    area = Math.abs(area / 2);
    const areaM2 = +((area / (GRID * GRID)) * scale * scale).toFixed(2);
    const el = { id: uid(), type: "room", points: polygon, area: areaM2, roomId: null, floorFinish: "A definir", floorColor: "#D9D4C8", ceilingFinish: "A definir" };
    commitElements([...elements, el]);
    setPolygon([]);
    setNamingId(el.id); setNamingValue("");
    setTool("selecionar");
  }

  function saveName() {
    if (namingId) onNameRoom(namingId, namingValue.trim());
    setNamingId(null); setNamingValue("");
  }
  function deleteRoom(id) {
    const room = elements.find(e => e.id === id);
    if (!room) { setNamingId(null); setNamingValue(""); return; }
    setDeletedStack(s => [...s, [room]]);
    commitElements(elements.filter(e => e.id !== id));
    setNamingId(null); setNamingValue("");
  }

  function undoLast() {
    if (tool === "ambiente" && polygon.length > 0) {
      setPolygon(polygon.slice(0, -Math.min(lastPolygonAdd, polygon.length)));
      return;
    }
    if (tool === "parede" && pending && elements.length) {
      const last = elements[elements.length - 1];
      // Mid-chain: undo the last segment but keep the chain going from its
      // start point, instead of just dropping the pending point. This is
      // itself a kind of undo, so it bypasses commitElements/history —
      // "Recente" shouldn't need pressing twice to get past its own effect.
      if (last.type === "wall" && last.x2 === pending.x && last.y2 === pending.y) {
        onChange(elements.slice(0, -1));
        setPending({ x: last.x1, y: last.y1 });
        return;
      }
    }
    if (pending) { setPending(null); return; }
    // Real undo: restore the elements as they were before the last
    // discrete action (add, delete, edit, drag...), not just whatever
    // happens to be the last entry in the current array — that broke on
    // anything that wasn't a plain "add" (e.g. undoing a move deleted an
    // unrelated element instead of moving the wall back).
    if (!history.length) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    onChange(prev);
  }
  function clearAll() {
    if (!window.confirm("Limpar todo o croqui deste nível? Essa ação não pode ser desfeita.")) return;
    commitElements([]); setPolygon([]); setPending(null); setSelectedId(null);
  }

  function tryMergeSelected() {
    if (!selected || selected.type !== "wall") return;
    const other = findMergeableWall(selected, elements);
    if (!other) return;
    const merged = mergeWallPair(selected, other);
    const newWall = { ...selected, ...merged, length: pxToMeters(dist({ x: merged.x1, y: merged.y1 }, { x: merged.x2, y: merged.y2 })) };
    const next = elements
      .filter(e => e.id !== other.id && e.id !== selected.id)
      .map(e => (e.wallId === other.id ? { ...e, wallId: newWall.id } : e));
    next.push(newWall);
    commitElements(next);
    setSelectedId(newWall.id);
  }

  function tryTrimCorner() {
    if (!selected || selected.type !== "wall") return;
    const other = findCornerWall(selected, elements);
    if (!other) return;
    const trimmed = trimWallsToCorner(selected, other);
    if (!trimmed) return;
    const newA = { ...selected, ...trimmed.a, length: pxToMeters(dist({ x: trimmed.a.x1, y: trimmed.a.y1 }, { x: trimmed.a.x2, y: trimmed.a.y2 })) };
    const newB = { ...other, ...trimmed.b, length: pxToMeters(dist({ x: trimmed.b.x1, y: trimmed.b.y1 }, { x: trimmed.b.x2, y: trimmed.b.y2 })) };
    commitElements(elements.map(e => (e.id === newA.id ? newA : e.id === newB.id ? newB : e)));
  }

  function splitSelectedWallAt(distM) {
    if (!selected || selected.type !== "wall") return;
    const dx = selected.x2 - selected.x1, dy = selected.y2 - selected.y1, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const cutPx = Math.min(len - 4, Math.max(4, (toNum(distM) / scale) * GRID));
    const mx = snap(selected.x1 + ux * cutPx), my = snap(selected.y1 + uy * cutPx);
    if ((mx === selected.x1 && my === selected.y1) || (mx === selected.x2 && my === selected.y2)) return;
    const wallCount = elements.filter(x => x.type === "wall").length;
    const partA = { ...selected, id: uid(), x2: mx, y2: my, tag: `P-${wallCount + 1}`, length: pxToMeters(dist({ x: selected.x1, y: selected.y1 }, { x: mx, y: my })) };
    const partB = { ...selected, id: uid(), x1: mx, y1: my, tag: `P-${wallCount + 2}`, length: pxToMeters(dist({ x: mx, y: my }, { x: selected.x2, y: selected.y2 })) };
    const midPos = (mx - selected.x1) * ux + (my - selected.y1) * uy;
    const next = elements.filter(e => e.id !== selected.id).map(e => {
      if (e.wallId !== selected.id) return e;
      const pos = (e.x - selected.x1) * ux + (e.y - selected.y1) * uy;
      return { ...e, wallId: pos <= midPos ? partA.id : partB.id };
    });
    next.push(partA, partB);
    commitElements(next);
    setSelectedId(partA.id);
    setSplittingWall(null);
  }

  function moveOpeningAlongWall(el, newPosM) {
    const w = wallsById[el.wallId];
    if (!w) return;
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const halfW = (toNum(el.width, 0.8) / scale) * GRID / 2;
    const lo = Math.min(halfW, len / 2), hi = Math.max(len - halfW, len / 2);
    const posPx = Math.max(lo, Math.min(hi, (newPosM / scale) * GRID));
    const nx = w.x1 + ux * posPx, ny = w.y1 + uy * posPx;
    commitElements(elements.map(e => e.id === el.id ? { ...e, x: nx, y: ny } : e));
    ensureVisible(nx, ny);
  }
  function openingPosM(el) {
    const w = wallsById[el.wallId];
    if (!w) return 0;
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const pos = (el.x - w.x1) * ux + (el.y - w.y1) * uy;
    return pxToMeters(pos);
  }

  function applyDimEdit() {
    if (!editingDim) return;
    const { wallId, gapIndex, value, ux, uy } = editingDim;
    const w = wallsById[wallId];
    if (!w) { setEditingDim(null); return; }
    const opens = elements.filter(e => (e.type === "door" || e.type === "window") && e.wallId === wallId)
      .map(o => ({ ...o, pos: (o.x - w.x1) * ux + (o.y - w.y1) * uy, halfW: (toNum(o.width, 0.8) / scale) * GRID / 2 }))
      .sort((a, b) => a.pos - b.pos);
    const dx0 = w.x2 - w.x1, dy0 = w.y2 - w.y1, len = Math.hypot(dx0, dy0) || 1;
    const gaps = [];
    let cursor = 0;
    opens.forEach(o => { const start = o.pos - o.halfW, end = o.pos + o.halfW; if (start - cursor > 3) gaps.push({ start: cursor, end: start, afterOpeningId: o.id }); cursor = Math.max(cursor, end); });
    if (len - cursor > 3) gaps.push({ start: cursor, end: len, afterOpeningId: null });
    const gap = gaps[gapIndex];
    if (!gap) { setEditingDim(null); return; }
    const newLenPx = Math.max(2, (toNum(value) / scale) * GRID);
    const rawDelta = newLenPx - (gap.end - gap.start);
    if (Math.abs(rawDelta) < 0.01) { setEditingDim(null); return; }

    if (gap.afterOpeningId) {
      const fromIdx = opens.findIndex(o => o.id === gap.afterOpeningId);
      const shifted = opens.slice(fromIdx);
      const prevEnd = fromIdx > 0 ? opens[fromIdx - 1].pos + opens[fromIdx - 1].halfW : 0;
      const minDelta = prevEnd - (shifted[0].pos - shifted[0].halfW) + 2;
      const maxDelta = len - (shifted[shifted.length - 1].pos + shifted[shifted.length - 1].halfW) - 2;
      const delta = Math.max(minDelta, Math.min(maxDelta, rawDelta));
      const shiftIds = new Set(shifted.map(o => o.id));
      let lastXY = null;
      commitElements(elements.map(e => {
        if (!shiftIds.has(e.id)) return e;
        const nx = e.x + ux * delta, ny = e.y + uy * delta;
        lastXY = { x: nx, y: ny };
        return { ...e, x: nx, y: ny };
      }));
      if (lastXY) ensureVisible(lastXY.x, lastXY.y);
    } else {
      const minLen = cursor + 2;
      const newLen = Math.max(minLen, len + rawDelta);
      const newX2 = w.x1 + ux * newLen, newY2 = w.y1 + uy * newLen;
      const newLenM = pxToMeters(dist({ x: w.x1, y: w.y1 }, { x: newX2, y: newY2 }));
      commitElements(elements.map(e => e.id === w.id ? { ...e, x2: newX2, y2: newY2, length: newLenM } : e));
      ensureVisible(newX2, newY2);
    }
    setEditingDim(null);
  }

  // movingEnd picks which endpoint moves to hit the new length — "end"
  // (default) keeps the start fixed and stretches from x2/y2, exactly the
  // old behavior; "start" keeps the end fixed and stretches from x1/y1, so
  // tapping a specific endpoint handle can grow/shrink the wall from that
  // same end instead of always anchoring at the start.
  // Moves wallId's chosen endpoint to newMoving, carrying along any other
  // wall/stair endpoint that was exactly joined to the OLD position — the
  // shared bit of logic behind both length-editing and straightening, so
  // neither of them ever pulls a corner apart from its neighbor.
  function moveWallEndAndLinked(wallId, movingEnd, oldMoving, newMoving) {
    const linked = [];
    elements.forEach(e => {
      if ((e.type !== "wall" && e.type !== "stair") || e.id === wallId) return;
      if (dist(oldMoving, { x: e.x1, y: e.y1 }) < 3) linked.push({ id: e.id, which: "start" });
      if (dist(oldMoving, { x: e.x2, y: e.y2 }) < 3) linked.push({ id: e.id, which: "end" });
    });
    const patch = movingEnd === "end" ? { x2: newMoving.x, y2: newMoving.y } : { x1: newMoving.x, y1: newMoving.y };
    commitElements(elements.map(e => {
      if (e.id === wallId) {
        const next = { ...e, ...patch };
        next.length = pxToMeters(dist({ x: next.x1, y: next.y1 }, { x: next.x2, y: next.y2 }));
        return next;
      }
      const link = linked.find(l => l.id === e.id);
      if (!link) return e;
      const next = link.which === "start" ? { ...e, x1: newMoving.x, y1: newMoving.y } : { ...e, x2: newMoving.x, y2: newMoving.y };
      next.length = pxToMeters(dist({ x: next.x1, y: next.y1 }, { x: next.x2, y: next.y2 }));
      return next;
    }));
    ensureVisible(newMoving.x, newMoving.y);
  }
  function setWallLengthDirect(wallId, newLenM, movingEnd = "end") {
    const w = wallsById[wallId];
    if (!w) return;
    const fixed = movingEnd === "end" ? { x: w.x1, y: w.y1 } : { x: w.x2, y: w.y2 };
    const oldMoving = movingEnd === "end" ? { x: w.x2, y: w.y2 } : { x: w.x1, y: w.y1 };
    // Typing a length must not just preserve whatever slight tilt the wall
    // already had — if it's already close to 0/45/90°, snap the direction
    // exactly first, same as dragging does, so this can also be how a
    // crooked wall gets straightened.
    const snappedDir = angleSnap(fixed, oldMoving);
    const dx = snappedDir.x - fixed.x, dy = snappedDir.y - fixed.y, dirLen = Math.hypot(dx, dy) || 1;
    const ux = dx / dirLen, uy = dy / dirLen;
    const newLenPx = Math.max(4, (toNum(newLenM) / scale) * GRID);
    const newMoving = { x: fixed.x + ux * newLenPx, y: fixed.y + uy * newLenPx };
    moveWallEndAndLinked(w.id, movingEnd, oldMoving, newMoving);
  }
  function applyWallLenEdit() {
    if (!editingWallLen) return;
    setWallLengthDirect(editingWallLen.wallId, editingWallLen.value, editingWallLen.movingEnd || "end");
    setEditingWallLen(null);
  }
  // Forces the wall onto the nearest 0/45/90° angle regardless of how far
  // off it currently is — an explicit action for when the passive 6°
  // auto-snap (drag, or typing a length) isn't enough to straighten an
  // already-crooked wall, without guessing at genuinely diagonal ones.
  function straightenWall(wallId, movingEnd) {
    const w = wallsById[wallId];
    if (!w) return;
    const fixed = movingEnd === "end" ? { x: w.x1, y: w.y1 } : { x: w.x2, y: w.y2 };
    const oldMoving = movingEnd === "end" ? { x: w.x2, y: w.y2 } : { x: w.x1, y: w.y1 };
    const len = dist(fixed, oldMoving) || 1;
    const angle = Math.atan2(oldMoving.y - fixed.y, oldMoving.x - fixed.x);
    const step = Math.PI / 4;
    const nearest = Math.round(angle / step) * step;
    const newMoving = { x: fixed.x + Math.cos(nearest) * len, y: fixed.y + Math.sin(nearest) * len };
    moveWallEndAndLinked(w.id, movingEnd, oldMoving, newMoving);
  }

  // Editing a face-to-face dimension moves the currently selected wall
  // (rigid translation along its own perpendicular) so the gap to the
  // other, fixed wall in the pair becomes the entered value — the other
  // wall never moves.
  function applyParallelDimEdit() {
    if (!editingParallelDim) return;
    const { movingWallId, fixedWallId, value } = editingParallelDim;
    const moving = wallsById[movingWallId];
    const fixed = wallsById[fixedWallId];
    if (!moving || !fixed) { setEditingParallelDim(null); return; }
    const dx = moving.x2 - moving.x1, dy = moving.y2 - moving.y1, len = Math.hypot(dx, dy) || 1;
    const nx = -(dy / len), ny = dx / len;
    const fmx = (fixed.x1 + fixed.x2) / 2, fmy = (fixed.y1 + fixed.y2) / 2;
    const signedDistPx = (fmx - moving.x1) * nx + (fmy - moving.y1) * ny;
    const dirSign = signedDistPx >= 0 ? 1 : -1;
    const halfSumM = wallThicknessM(moving.wallType) / 2 + wallThicknessM(fixed.wallType) / 2;
    const newCenterM = Math.max(0.02, toNum(value, 0) + halfSumM);
    const newCenterPx = (newCenterM / scale) * GRID;
    const k = signedDistPx - dirSign * newCenterPx;
    const tx = k * nx, ty = k * ny;
    commitElements(elements.map(e => e.id === moving.id
      ? { ...e, x1: e.x1 + tx, y1: e.y1 + ty, x2: e.x2 + tx, y2: e.y2 + ty }
      : e));
    setEditingParallelDim(null);
  }

  function luminariaDimensions(lm) {
    const walls = elements.filter(e => e.type === "wall");
    const lums = elements.filter(e => e.type === "luminaria" && e.id !== lm.id);
    let wallDim = null;
    walls.forEach(w => {
      const proj = projectPointOnSegment({ x: lm.x, y: lm.y }, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
      const d = dist({ x: lm.x, y: lm.y }, proj);
      if (!wallDim || d < wallDim.d) wallDim = { target: proj, d, wallId: w.id };
    });
    let lumDim = null;
    lums.forEach(other => {
      const d = dist({ x: lm.x, y: lm.y }, { x: other.x, y: other.y });
      if (!lumDim || d < lumDim.d) lumDim = { target: { x: other.x, y: other.y }, d, otherId: other.id };
    });
    return { wallDim, lumDim };
  }

  function applyLumDimEdit() {
    if (!editingLumDim) return;
    const { lumId, refX, refY, value } = editingLumDim;
    const lm = elements.find(e => e.id === lumId);
    if (!lm) { setEditingLumDim(null); return; }
    const dx = lm.x - refX, dy = lm.y - refY, curD = Math.hypot(dx, dy) || 1;
    const ux = dx / curD, uy = dy / curD;
    const newDPx = Math.max(2, (toNum(value) / scale) * GRID);
    const nx = refX + ux * newDPx, ny = refY + uy * newDPx;
    commitElements(elements.map(e => e.id === lumId ? { ...e, x: nx, y: ny } : e));
    ensureVisible(nx, ny);
    setEditingLumDim(null);
  }

  function startLabelDrag(el, e) {
    e.stopPropagation(); e.preventDefault();
    // Don't commit to a drag (and snapshot history for one) on pointerdown
    // alone — a plain tap-to-edit also lands here first, and it should
    // neither pollute the undo stack nor require the pointer to move at
    // all. history/isDraggingRef only get set once real movement is seen,
    // in onLabelDragMove below. The room name (Piso tab) and the ceiling
    // finish (Forro tab) are two independent labels on the same room, so
    // which offset/rotation field this drag writes to depends on which
    // tab's label was actually grabbed, not the room itself.
    const centroid = polygonCentroid(el.points);
    const offsetField = planMode === "forro" ? "ceilingLabelOffset" : "labelOffset";
    setDraggingLabel({ id: el.id, centroid, startP: svgPointRaw(e), moved: false, offsetField });
  }
  function onLabelDragMove(e) {
    if (!draggingLabel) return;
    const p = svgPointRaw(e);
    const el = elements.find(x => x.id === draggingLabel.id);
    if (!el) return;
    if (!draggingLabel.moved) {
      if (dist(p, draggingLabel.startP) < 3) return; // still just a tap-in-progress
      pushHistory();
      isDraggingRef.current = true;
      setDraggingLabel(d => (d ? { ...d, moved: true } : d));
    }
    // Requiring the exact pointer position to stay inside the polygon
    // made this unusable on any room that tapers to a narrow point (like
    // a thin triangle) — a real finger can't trace a path that stays
    // inside a sliver only centimeters wide while sliding toward the
    // room's wider end, so the drag would just freeze. Clamp to the
    // room's bounding box instead: it still keeps the label from being
    // dragged off into unrelated parts of the canvas, but never blocks
    // reaching any part of the room's own shape.
    const xs = el.points.map(pt => pt.x), ys = el.points.map(pt => pt.y);
    const cx = Math.max(Math.min(...xs), Math.min(Math.max(...xs), p.x));
    const cy = Math.max(Math.min(...ys), Math.min(Math.max(...ys), p.y));
    const centroid = draggingLabel.centroid;
    const field = draggingLabel.offsetField;
    commitElements(elements.map(x => x.id === el.id ? { ...x, [field]: { dx: cx - centroid.x, dy: cy - centroid.y } } : x));
  }
  function onLabelDragEnd() {
    // A tap that never moved past the drag threshold — treat it as
    // "tap the label to edit" instead of silently doing nothing, the same
    // way tapping a wall's length label opens its editor directly. The
    // room name has its own free-text rename box; the ceiling finish is a
    // fixed list, so tapping it opens the room's properties panel where
    // that dropdown (and Girar nome) already live.
    if (draggingLabel && !draggingLabel.moved) {
      const el = elements.find(x => x.id === draggingLabel.id);
      if (el) {
        if (draggingLabel.offsetField === "ceilingLabelOffset") setSelectedId(el.id);
        else { setNamingId(el.id); setNamingValue(el.name || ""); }
      }
    }
    setDraggingLabel(null);
    isDraggingRef.current = false;
  }

  // A pre-2D-drag save could have a plain number here (the old
  // perpendicular-only nudge) — read it back as { perp, along: 0 } so
  // existing projects don't lose their adjustment when this loads.
  function readDimNudge(wallA, otherId) {
    const raw = wallA && wallA.dimNudge && wallA.dimNudge[otherId];
    if (raw && typeof raw === "object") return raw;
    return { perp: typeof raw === "number" ? raw : 0, along: 0 };
  }
  // Lets the user manually slide a parallel-wall dimension's label freely
  // in the plane of its own dimension line — perpendicular to it (nx,ny,
  // parallel to the walls themselves) to pull it out from behind another
  // dimension it's colliding with, AND along it (ux,uy, between the two
  // wall faces) to reposition it along the line the same way the label's
  // own rotation now reads (parallel to the line, not always horizontal).
  // The nudge is stored on the wall (dimNudge, keyed by the other wall's
  // id) rather than component state so it survives VectorSketch remounting
  // on tab switch, and each axis is clamped independently — perp to the
  // pair's shared overlap span, along to the gap between the two wall
  // faces — so the label can't be dragged out of the room in either
  // direction.
  function beginDragDimLabel(wallA, otherId, ux, uy, nx, ny, overlapMin, overlapMax, faceLen, labelT, startEdit, e) {
    if (tool !== "selecionar") return;
    if (e.touches && e.touches.length > 1) return;
    e.stopPropagation(); e.preventDefault();
    const startNudge = readDimNudge(wallA, otherId);
    setDraggingDimLabel({ wallId: wallA.id, otherId, ux, uy, nx, ny, overlapMin, overlapMax, faceLen, labelT, startP: svgPointRaw(e), startNudge, moved: false, startEdit });
  }
  function onDimLabelDragMove(e) {
    if (!draggingDimLabel) return;
    const p = svgPointRaw(e);
    const d = draggingDimLabel;
    if (!d.moved) {
      if (dist(p, d.startP) < 3) return; // still just a tap-in-progress
      pushHistory();
      isDraggingRef.current = true;
      setDraggingDimLabel(s => (s ? { ...s, moved: true } : s));
    }
    const dxp = p.x - d.startP.x, dyp = p.y - d.startP.y;
    const deltaPerp = dxp * d.nx + dyp * d.ny;
    const deltaAlong = dxp * d.ux + dyp * d.uy;
    const maxPerp = Math.max(0, (d.overlapMax - d.overlapMin) / 2 - GRID);
    const perp = Math.max(-maxPerp, Math.min(maxPerp, d.startNudge.perp + deltaPerp));
    // The label's un-nudged position already sits at labelT along the
    // face-to-face line (T0), not at its midpoint — clamp the ALONG offset
    // relative to that base position, keeping a small margin so the label
    // never slides on top of either wall's own face.
    const T0 = d.faceLen * d.labelT;
    const margin = Math.min(10, d.faceLen / 2);
    const alongLo = Math.min(margin - T0, d.faceLen - margin - T0);
    const alongHi = Math.max(margin - T0, d.faceLen - margin - T0);
    const along = Math.max(alongLo, Math.min(alongHi, d.startNudge.along + deltaAlong));
    commitElements(elements.map(el => el.id === d.wallId
      ? { ...el, dimNudge: { ...(el.dimNudge || {}), [d.otherId]: { perp, along } } }
      : el));
  }
  function onDimLabelDragEnd() {
    if (draggingDimLabel && !draggingDimLabel.moved) draggingDimLabel.startEdit();
    setDraggingDimLabel(null);
    isDraggingRef.current = false;
  }
  function rotateRoomLabel(el) {
    const field = planMode === "forro" ? "ceilingLabelRotation" : "labelRotation";
    const next = ((el[field] || 0) + 90) % 360;
    commitElements(elements.map(x => x.id === el.id ? { ...x, [field]: next } : x));
  }

  function beginDragWallMove(w, e) {
    if (tool !== "selecionar") return;
    // A second finger landing on/near the element (pinching right on top of
    // it, a very natural gesture) must not get claimed as a drag — that
    // would stopPropagation before the pinch handler on the SVG ever sees
    // it, leaving pinch-to-zoom completely dead on selected elements.
    if (e.touches && e.touches.length > 1) return;
    e.stopPropagation(); e.preventDefault();
    pushHistory();
    isDraggingRef.current = true;
    setSelectedId(w.id);
    setDragSession({ kind: "wall-move", id: w.id, startPointer: svgPointRaw(e), orig: { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 } });
  }
  function beginDragWallEndpoint(w, which, e) {
    if (e.touches && e.touches.length > 1) return;
    e.stopPropagation(); e.preventDefault();
    pushHistory();
    isDraggingRef.current = true;
    setSelectedId(w.id);
    const pt = which === "start" ? { x: w.x1, y: w.y1 } : { x: w.x2, y: w.y2 };
    // Any other wall whose own endpoint exactly coincides with the one
    // being dragged is a joined neighbor — it needs to move together with
    // this point, otherwise the corner splits apart during the drag. This
    // also has to be excluded from the nearby-endpoint snap below, or it'd
    // just snap the point straight back to where it already was.
    const linked = [];
    elements.forEach(e2 => {
      if ((e2.type !== "wall" && e2.type !== "stair") || e2.id === w.id) return;
      if (dist(pt, { x: e2.x1, y: e2.y1 }) < 3) linked.push({ id: e2.id, which: "start" });
      if (dist(pt, { x: e2.x2, y: e2.y2 }) < 3) linked.push({ id: e2.id, which: "end" });
    });
    setDragSession({ kind: "wall-endpoint", id: w.id, which, linked });
  }
  function beginDragOpening(el, e) {
    if (tool !== "selecionar") return;
    if (e.touches && e.touches.length > 1) return;
    e.stopPropagation(); e.preventDefault();
    pushHistory();
    isDraggingRef.current = true;
    setSelectedId(el.id);
    setDragSession({ kind: "opening", id: el.id, wallId: el.wallId });
  }
  function onCanvasPointerMove(e) {
    onLabelDragMove(e);
    onDimLabelDragMove(e);
    if (!dragSession) return;
    if (e.cancelable) e.preventDefault();
    const p = svgPointRaw(e);
    if (dragSession.kind === "wall-move") {
      const dx = p.x - dragSession.startPointer.x, dy = p.y - dragSession.startPointer.y;
      const nx1 = snap(dragSession.orig.x1 + dx), ny1 = snap(dragSession.orig.y1 + dy);
      const nx2 = snap(dragSession.orig.x2 + dx), ny2 = snap(dragSession.orig.y2 + dy);
      const actualDx = nx1 - dragSession.orig.x1, actualDy = ny1 - dragSession.orig.y1;
      commitElements(elements.map(el => {
        if (el.id === dragSession.id) return { ...el, x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
        if (el.wallId === dragSession.id) return { ...el, x: el.x + actualDx, y: el.y + actualDy };
        return el;
      }));
    } else if (dragSession.kind === "wall-endpoint") {
      const w = wallsById[dragSession.id];
      const linked = dragSession.linked || [];
      // Linked (already-joined) neighbors must never be candidates for the
      // nearby-endpoint snap — they still sit at the OLD position we're
      // trying to move away from, so snapping to them would just pull the
      // point straight back and make it impossible to ever straighten.
      const linkedIds = new Set(linked.map(l => l.id));
      const hit = w && findNearbyEndpoint(p, dragSession.id, linkedIds);
      let sp = hit || { x: snap(p.x), y: snap(p.y) };
      if (!hit && w) {
        const fixedPt = dragSession.which === "start" ? { x: w.x2, y: w.y2 } : { x: w.x1, y: w.y1 };
        sp = angleSnap(fixedPt, sp);
      }
      commitElements(elements.map(el => {
        if (el.id === dragSession.id) {
          const next = dragSession.which === "start" ? { ...el, x1: sp.x, y1: sp.y } : { ...el, x2: sp.x, y2: sp.y };
          next.length = pxToMeters(dist({ x: next.x1, y: next.y1 }, { x: next.x2, y: next.y2 }));
          return next;
        }
        const link = linked.find(l => l.id === el.id);
        if (link) {
          const next = link.which === "start" ? { ...el, x1: sp.x, y1: sp.y } : { ...el, x2: sp.x, y2: sp.y };
          next.length = pxToMeters(dist({ x: next.x1, y: next.y1 }, { x: next.x2, y: next.y2 }));
          return next;
        }
        return el;
      }));
    } else if (dragSession.kind === "opening") {
      const w = wallsById[dragSession.wallId];
      if (!w) return;
      const proj = projectPointOnSegment(p, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
      commitElements(elements.map(el => el.id === dragSession.id ? { ...el, x: proj.x, y: proj.y } : el));
    }
  }
  function onCanvasPointerUp() { onLabelDragEnd(); onDimLabelDragEnd(); setDragSession(null); }

  // Angle (degrees) to rotate a dimension label so it runs parallel to the
  // wall it measures instead of always sitting flat/horizontal — flipped
  // 180° whenever the raw angle would otherwise render the text upside
  // down, so it always reads left-to-right.
  function labelAngleDeg(w) {
    let deg = Math.atan2(w.y2 - w.y1, w.x2 - w.x1) * 180 / Math.PI;
    if (deg > 90 || deg < -90) deg += 180;
    return deg;
  }
  // How far (and to which side) a wall's own length label sits off the
  // wall line — pushed away from the rough centroid of all the walls
  // being sketched, so a label on any side of a shape (top, bottom, left,
  // right) lands outside it instead of on top of the line or collapsing
  // into the middle when another wall runs close and roughly parallel.
  function wallLabelOffset(el, extra = 0) {
    const dx = el.x2 - el.x1, dy = el.y2 - el.y1, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const walls = elements.filter(e => e.type === "wall");
    let cx = 0, cy = 0;
    walls.forEach(w => { cx += (w.x1 + w.x2) / 2; cy += (w.y1 + w.y2) / 2; });
    cx /= walls.length; cy /= walls.length;
    const midX = (el.x1 + el.x2) / 2, midY = (el.y1 + el.y2) / 2;
    const dot = (cx - midX) * nx + (cy - midY) * ny;
    const side = dot > 0 ? -1 : 1;
    const offDir = { x: nx * side, y: ny * side };

    // The text is rotated to run parallel to the wall (labelAngleDeg),
    // which also rotates which way its glyph body grows from the
    // baseline anchor — for a near-vertical wall that direction ends up
    // pointing back toward the wall instead of away from it, visually
    // shrinking the gap unless the base distance is pushed out to
    // compensate. A more diagonal wall doesn't have this problem (its
    // glyphs already grow away from the line), so it needs no extra.
    const rad = labelAngleDeg(el) * Math.PI / 180;
    const ascentDir = { x: Math.sin(rad), y: -Math.cos(rad) };
    const towardWall = Math.max(0, -(ascentDir.x * offDir.x + ascentDir.y * offDir.y));
    const D = 8, ASCENT = 7;
    const dist = D + towardWall * ASCENT + extra;
    return { x: offDir.x * dist, y: offDir.y * dist };
  }
  function wallDimensions(w) {
    const opens = elements.filter(e => (e.type === "door" || e.type === "window") && e.wallId === w.id);
    if (!opens.length) return null;
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    // Half a grid square out from the wall's centerline — a full square
    // (the previous 13, close to GRID's own 20) read as needlessly far
    // from the wall it's actually measuring.
    const offset = GRID / 2;
    const ivs = opens.map(o => {
      const pos = (o.x - w.x1) * ux + (o.y - w.y1) * uy;
      const halfW = (toNum(o.width, 0.8) / scale) * GRID / 2;
      return { id: o.id, start: pos - halfW, end: pos + halfW };
    }).sort((a, b) => a.start - b.start);
    const gaps = [];
    let cursor = 0;
    ivs.forEach(iv => { if (iv.start - cursor > 3) gaps.push({ start: cursor, end: iv.start, afterOpeningId: iv.id }); cursor = Math.max(cursor, iv.end); });
    if (len - cursor > 3) gaps.push({ start: cursor, end: len, afterOpeningId: null });
    return gaps.map((g, i) => {
      const { start: s, end: e2 } = g;
      const p1 = { x: w.x1 + ux * s + nx * offset, y: w.y1 + uy * s + ny * offset };
      const p2 = { x: w.x1 + ux * e2 + nx * offset, y: w.y1 + uy * e2 + ny * offset };
      const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
      const lenM = (((e2 - s) / GRID) * scale).toFixed(2);
      const isEditing = editingDim && editingDim.wallId === w.id && editingDim.gapIndex === i;
      const editable = tool === "selecionar" && selectedId === w.id;
      return (
        <g key={w.id + "-dim-" + i}>
          <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#4A4A46" strokeWidth="0.75" />
          <line x1={p1.x - nx * 4} y1={p1.y - ny * 4} x2={p1.x + nx * 4} y2={p1.y + ny * 4} stroke="#4A4A46" strokeWidth="0.75" />
          <line x1={p2.x - nx * 4} y1={p2.y - ny * 4} x2={p2.x + nx * 4} y2={p2.y + ny * 4} stroke="#4A4A46" strokeWidth="0.75" />
          {editable && (
            <rect x={midX - 12} y={midY - 12} width="24" height="12" fill={isEditing ? "#4A4A46" : "transparent"} opacity={isEditing ? 0.3 : 1}
              style={{ cursor: "pointer" }}
              onClick={e => { e.stopPropagation(); setEditingDim({ wallId: w.id, gapIndex: i, value: lenM, ux, uy }); }} />
          )}
          <text x={midX} y={midY - 3} fontSize="7.5" fill="#4A4A46" textAnchor="middle" transform={`rotate(${labelAngleDeg(w)} ${midX} ${midY - 3})`}
            style={{ pointerEvents: editable ? "auto" : "none", cursor: editable ? "pointer" : undefined }}
            onClick={editable ? (e => { e.stopPropagation(); setEditingDim({ wallId: w.id, gapIndex: i, value: lenM, ux, uy }); }) : undefined}>{lenM}</text>
        </g>
      );
    });
  }

  function ghostLevel(lvl, color) {
    if (!lvl) return null;
    const els = lvl.sketchElements || [];
    return (
      <g opacity="0.35" pointerEvents="none">
        {els.filter(e => e.type === "wall").map(w => <line key={w.id} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke={color} strokeWidth="3" strokeDasharray="5,3" />)}
        {els.filter(e => e.type === "room").map(r => <polygon key={r.id} points={r.points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={color} strokeWidth="1" strokeDasharray="2,3" />)}
      </g>
    );
  }

  const PISO_TOOLS = [
    { id: "selecionar", label: "Selecionar", Icon: MousePointer2 },
    { id: "parede", label: "Parede", Icon: BrickWall },
    { id: "ambiente", label: "Ambiente", Icon: LayoutPanelTop },
    { id: "porta", label: "Porta", Icon: DoorClosed },
    { id: "janela", label: "Janela", Icon: WindowIcon },
    { id: "escada", label: "Escada", Icon: StairsIcon },
    { id: "apagar", label: "Apagar", Icon: Eraser },
  ];
  const FORRO_TOOLS = [
    { id: "selecionar", label: "Selecionar", Icon: MousePointer2 },
    { id: "ambiente", label: "Ambiente (acabamento)", Icon: LayoutPanelTop },
    { id: "luminaria", label: "Luminária", Icon: Lightbulb },
    { id: "apagar", label: "Apagar", Icon: Eraser },
  ];
  const TOOLS = planMode === "forro" ? FORRO_TOOLS : PISO_TOOLS;

  return (
    <div>
      <div className="flex gap-1.5 mb-2">
        <button onClick={() => { setPlanMode("piso"); setTool("selecionar"); setSelectedId(null); }} className="flex-1 py-1.5 rounded text-[11px]"
          style={{ ...heading, fontWeight: 600, background: planMode === "piso" ? C.gold : C.panelAlt, color: planMode === "piso" ? "#141311" : C.mute }}>Planta de Piso</button>
        <button onClick={() => { setPlanMode("forro"); setTool("selecionar"); setSelectedId(null); }} className="flex-1 py-1.5 rounded text-[11px]"
          style={{ ...heading, fontWeight: 600, background: planMode === "forro" ? C.gold : C.panelAlt, color: planMode === "forro" ? "#141311" : C.mute }}>Planta de Forro</button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-1">
        {TOOLS.map(({ id, label, Icon }) => {
          const active = tool === id;
          const activeColor = id === "apagar" ? C.bad : C.gold;
          return (
            <button key={id} onClick={() => { setTool(id); setPending(null); setEditingWallLen(null); setEditingDim(null); setEditingParallelDim(null); }} title={label}
              className="flex items-center justify-center p-2 rounded"
              style={{ background: active ? (id === "apagar" ? "rgba(193,84,63,0.16)" : C.goldTint) : C.panelAlt, color: active ? activeColor : C.mute, border: `1px solid ${active ? activeColor : C.line}` }}>
              <Icon size={16} />
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-1 text-[10px]" style={{ color: C.mute }}>
        {planMode === "piso" && (
          <>
            <span className="flex items-center gap-1" title="1 quadro ="><Grid2x2 size={12} /> =
              <input type="text" inputMode="decimal" value={scale} onChange={e => onMeta({ sketchScale: e.target.value })}
                className="w-12 px-1 py-0.5 rounded text-[10px]" style={{ background: C.panelAlt, color: C.chalk, border: `1px solid ${C.line}` }} /> m
            </span>
            <span className="flex items-center gap-1" title="Pé-direito das novas paredes">PD
              <input type="text" inputMode="decimal" value={wallHeightDefault} onChange={e => onMeta({ wallHeightDefault: e.target.value })}
                className="w-14 px-1 py-0.5 rounded text-[10px]" style={{ background: C.panelAlt, color: C.chalk, border: `1px solid ${C.line}` }} /> m
            </span>
            <span className="flex items-center gap-1" title="Cor das cotas entre paredes">
              <Ruler size={12} />
              <input type="color" value={dimColor} onChange={e => onMeta({ dimColor: e.target.value })}
                className="w-5 h-5 rounded" style={{ border: `1px solid ${C.line}`, background: "transparent" }} />
            </span>
            {(belowLevel || aboveLevel) && (
              <span className="flex items-center gap-2">
                {belowLevel && (
                  <label className="flex items-center gap-1"><input type="checkbox" checked={showBelow} onChange={e => setShowBelow(e.target.checked)} /> ver {belowLevel.name}</label>
                )}
                {aboveLevel && (
                  <label className="flex items-center gap-1"><input type="checkbox" checked={showAbove} onChange={e => setShowAbove(e.target.checked)} /> ver {aboveLevel.name}</label>
                )}
              </span>
            )}
          </>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setShowGrid(g => !g)} className="p-1.5 rounded" style={{ background: showGrid ? C.goldTint : C.panelAlt, border: `1px solid ${showGrid ? C.gold : C.line}` }}><Grid3x3 size={13} color={showGrid ? C.gold : C.chalk} /></button>
          <button onClick={() => zoomButton(0.8)} className="p-1.5 rounded" style={{ background: C.panelAlt, border: `1px solid ${C.line}` }}><ZoomIn size={13} color={C.chalk} /></button>
          <button onClick={() => zoomButton(1.25)} className="p-1.5 rounded" style={{ background: C.panelAlt, border: `1px solid ${C.line}` }}><ZoomOut size={13} color={C.chalk} /></button>
          <button onClick={resetZoom} title="Centralizar e enquadrar tudo" className="p-1.5 rounded" style={{ background: C.panelAlt, border: `1px solid ${C.line}` }}><Maximize2 size={13} color={C.chalk} /></button>
        </div>
      </div>

      {tool === "ambiente" && planMode === "piso" && (
        <div className="flex flex-col gap-1.5 mb-2">
          <div className="flex items-center gap-1.5">
            <button onClick={() => { setAmbienteAuto(true); setAutoRoomMsg(""); }} title="Toque dentro de um ambiente com paredes fechadas"
              className="text-[10px] px-2 py-1 rounded" style={{ background: ambienteAuto ? C.goldTint : C.panelAlt, color: ambienteAuto ? C.gold : C.mute, border: `1px solid ${ambienteAuto ? C.gold : C.line}` }}>Automático</button>
            <button onClick={() => { setAmbienteAuto(false); setAutoRoomMsg(""); }} title="Marque cada ponto do contorno na mão — para varandas e ambientes sem paredes fechadas"
              className="text-[10px] px-2 py-1 rounded" style={{ background: !ambienteAuto ? C.goldTint : C.panelAlt, color: !ambienteAuto ? C.gold : C.mute, border: `1px solid ${!ambienteAuto ? C.gold : C.line}` }}>Manual (pontos)</button>
          </div>
          {ambienteAuto && polygon.length === 0 && !autoRoomMsg && (
            <span className="text-[10px]" style={{ color: C.mute }}>Toque dentro de um ambiente com paredes fechadas.</span>
          )}
          {autoRoomMsg && <span className="text-[10px]" style={{ color: C.bad }}>{autoRoomMsg}</span>}
          {(!ambienteAuto || polygon.length > 0) && (
            <div className="flex items-center gap-2 text-[11px]" style={{ color: C.mute }}>
              <span>{polygon.length} ponto(s) marcados</span>
              <button onClick={closePolygon} disabled={polygon.length < 3}
                className="px-2 py-1 rounded" style={{ ...heading, fontWeight: 600, background: C.goldTint, color: C.gold, opacity: polygon.length < 3 ? 0.4 : 1 }}>Fechar ambiente</button>
            </div>
          )}
        </div>
      )}

      {namingId && (
        <div className="flex items-center gap-2 mb-2 p-2 rounded" style={{ background: C.goldTint, border: `1px solid ${C.gold}` }}>
          <span className="text-[11px] shrink-0" style={{ color: C.gold }}>Nome do ambiente:</span>
          <input autoFocus value={namingValue} onChange={e => setNamingValue(e.target.value)}
            onKeyDown={e => e.key === "Enter" && saveName()}
            className="flex-1 px-2 py-1 rounded text-xs" style={{ background: "rgba(255,255,255,0.08)", color: C.chalk, border: `1px solid ${C.line}` }} />
          <button onClick={saveName} className="text-[11px] px-2 py-1 rounded" style={{ background: C.gold, color: "#141311" }}>Salvar</button>
          <button onClick={() => deleteRoom(namingId)} title="Apagar este ambiente" className="text-[11px] px-1.5" style={{ color: C.bad }}><Trash2 size={13} /></button>
          <button onClick={() => { setNamingId(null); setNamingValue(""); }} className="text-[11px] px-1.5" style={{ color: C.mute }}><X size={13} /></button>
        </div>
      )}

      {editingDim && (
        <div className="flex items-center gap-1.5 mb-1.5 p-1.5 rounded" style={{ background: C.goldTint, border: `1px solid ${C.gold}` }}>
          <span className="text-[11px] shrink-0" style={{ color: C.gold }}>Distância (m):</span>
          <input autoFocus type="text" inputMode="decimal" value={editingDim.value} onChange={e => setEditingDim({ ...editingDim, value: e.target.value })}
            onKeyDown={e => e.key === "Enter" && applyDimEdit()}
            className="w-16 px-2 py-1 rounded text-xs" style={{ background: "rgba(255,255,255,0.08)", color: C.chalk, border: `1px solid ${C.line}` }} />
          <button onClick={applyDimEdit} className="text-[11px] px-2 py-1 rounded ml-auto shrink-0" style={{ background: C.gold, color: "#141311" }}>Aplicar</button>
          <button onClick={() => setEditingDim(null)} className="text-[11px] px-1 shrink-0" style={{ color: C.mute }}><X size={13} /></button>
        </div>
      )}

      {editingWallLen && (
        <div className="flex items-center gap-1.5 mb-1.5 p-1.5 rounded" style={{ background: C.goldTint, border: `1px solid ${C.gold}` }}>
          <span className="text-[11px] shrink-0" style={{ color: C.gold }}>Comprimento (m):</span>
          <input autoFocus type="text" inputMode="decimal" value={editingWallLen.value} onChange={e => setEditingWallLen({ ...editingWallLen, value: e.target.value })}
            onKeyDown={e => e.key === "Enter" && applyWallLenEdit()}
            className="w-16 px-2 py-1 rounded text-xs" style={{ background: "rgba(255,255,255,0.08)", color: C.chalk, border: `1px solid ${C.line}` }} />
          <button onClick={() => straightenWall(editingWallLen.wallId, editingWallLen.movingEnd || "end")} title="Deixar reto (0/45/90°)"
            className="p-1.5 rounded ml-auto shrink-0" style={{ background: C.panelAlt, border: `1px solid ${C.line}` }}><CornerUpRight size={13} color={C.chalk} /></button>
          <button onClick={applyWallLenEdit} className="text-[11px] px-2 py-1 rounded shrink-0" style={{ background: C.gold, color: "#141311" }}>Aplicar</button>
          <button onClick={() => setEditingWallLen(null)} className="text-[11px] px-1 shrink-0" style={{ color: C.mute }}><X size={13} /></button>
        </div>
      )}
      {editingParallelDim && (
        <div className="flex items-center gap-1.5 mb-1.5 p-1.5 rounded" style={{ background: C.goldTint, border: `1px solid ${C.gold}` }}>
          <span className="text-[11px] shrink-0" style={{ color: C.gold }}>Face a face (m):</span>
          <input autoFocus type="text" inputMode="decimal" value={editingParallelDim.value} onChange={e => setEditingParallelDim({ ...editingParallelDim, value: e.target.value })}
            onKeyDown={e => e.key === "Enter" && applyParallelDimEdit()}
            className="w-16 px-2 py-1 rounded text-xs" style={{ background: "rgba(255,255,255,0.08)", color: C.chalk, border: `1px solid ${C.line}` }} />
          <button onClick={applyParallelDimEdit} className="text-[11px] px-2 py-1 rounded ml-auto shrink-0" style={{ background: C.gold, color: "#141311" }}>Aplicar</button>
          <button onClick={() => setEditingParallelDim(null)} className="text-[11px] px-1 shrink-0" style={{ color: C.mute }}><X size={13} /></button>
        </div>
      )}

      <svg ref={svgRef} width="100%" height={dims.h} viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className="rounded-md touch-none" style={{ background: "#DCDCD8", border: "1px solid #C6C6C1", display: "block", touchAction: "none" }}
        onClick={handleTap} onWheel={onWheel}
        onTouchStart={onTouchStartCanvas} onTouchMove={onTouchMoveCanvas} onTouchEnd={onTouchEndCanvas}
        onMouseMove={onCanvasPointerMove} onMouseUp={onCanvasPointerUp} onMouseLeave={onCanvasPointerUp}>
        <defs>
          <pattern id={`grid-${level.id}`} width={GRID} height={GRID} patternUnits="userSpaceOnUse">
            <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="#C6C6C1" strokeWidth="1" />
          </pattern>
        </defs>
        <rect x={viewBox.x - viewBox.w} y={viewBox.y - viewBox.h} width={viewBox.w * 3} height={viewBox.h * 3} fill={showGrid ? `url(#grid-${level.id})` : "#DCDCD8"} />

        {showBelow && ghostLevel(belowLevel, "#8A8880")}
        {showAbove && ghostLevel(aboveLevel, "#4A4A46")}

        {planMode === "piso" && elements.filter(el => el.type === "room").map(el => {
          const centroid = polygonCentroid(el.points);
          const lines = wrapTextLines(el.name || "Ambiente sem nome", 14);
          const totalLines = lines.length + 1;
          const lineHeight = 11;
          const lx = centroid.x + (el.labelOffset?.dx ?? 0);
          const ly = centroid.y + (el.labelOffset?.dy ?? 0);
          const topY = ly - ((totalLines - 1) * lineHeight) / 2;
          const rot = el.labelRotation || 0;
          const isSel = selectedId === el.id;
          const longest = Math.max(...lines.map(l => l.length), String(el.area).length + 3);
          const hitW = longest * 5.6 + 10, hitH = totalLines * lineHeight + 8;
          return (
            <g key={el.id}>
              <polygon points={el.points.map(p => `${p.x},${p.y}`).join(" ")} fill="rgba(0,0,0,0.06)" stroke={isSel ? "#726F68" : "#4A4A46"} strokeWidth={isSel ? 2.5 : 1.5} />
              <g style={{ cursor: "move" }} onMouseDown={e => startLabelDrag(el, e)} onTouchStart={e => startLabelDrag(el, e)} transform={rot ? `rotate(${rot} ${lx} ${ly})` : undefined}>
                <rect x={lx - hitW / 2} y={ly - hitH / 2} width={hitW} height={hitH} fill="rgba(255,255,255,0.001)" />
                {lines.map((ln, i) => <text key={i} x={lx} y={topY + i * lineHeight} fontSize="10" fontWeight="600" fill="#4A4A46" textAnchor="middle" style={{ pointerEvents: "none" }}>{ln}</text>)}
                <text x={lx} y={topY + lines.length * lineHeight} fontSize="9" fill="#4A4A46" textAnchor="middle" style={{ pointerEvents: "none" }}>{el.area} m²</text>
              </g>
            </g>
          );
        })}
        {planMode === "forro" && elements.filter(el => el.type === "room").map(el => {
          const centroid = polygonCentroid(el.points);
          const label = el.ceilingFinish && el.ceilingFinish !== "A definir" ? el.ceilingFinish : "Forro sem acabamento";
          const lines = wrapTextLines(label, 14);
          const lineHeight = 10;
          const lx = centroid.x + (el.ceilingLabelOffset?.dx ?? -20);
          const ly = centroid.y + (el.ceilingLabelOffset?.dy ?? 0);
          const topY = ly - ((lines.length - 1) * lineHeight) / 2;
          const rot = el.ceilingLabelRotation || 0;
          const isSel = selectedId === el.id;
          const longest = Math.max(...lines.map(l => l.length), 1);
          const hitW = longest * 5 + 10, hitH = lines.length * lineHeight + 8;
          return (
            <g key={el.id}>
              <polygon points={el.points.map(p => `${p.x},${p.y}`).join(" ")} fill="rgba(0,0,0,0.05)" stroke={isSel ? "#726F68" : "#8A8880"} strokeWidth={isSel ? 2.5 : 1} strokeDasharray="3,3" />
              <g style={{ cursor: "move" }} onMouseDown={e => startLabelDrag(el, e)} onTouchStart={e => startLabelDrag(el, e)} transform={rot ? `rotate(${rot} ${lx} ${ly})` : undefined}>
                <rect x={lx - hitW / 2} y={ly - hitH / 2} width={hitW} height={hitH} fill="rgba(255,255,255,0.001)" />
                {lines.map((ln, i) => <text key={i} x={lx} y={topY + i * lineHeight} fontSize="8" fill="#6B6862" textAnchor="middle" style={{ pointerEvents: "none" }}>{ln}</text>)}
              </g>
            </g>
          );
        })}
        {elements.filter(el => el.type === "wall").map(el => (
          <g key={el.id} opacity={planMode === "forro" ? 0.35 : 1}>
            <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2}
              stroke={selectedId === el.id ? "#726F68" : phaseColor(el) || "#1B1E1A"} strokeWidth={selectedId === el.id ? 6 : 4} strokeLinecap="square"
              strokeDasharray={phaseColor(el) ? "7,5" : undefined}
              style={{ cursor: tool === "selecionar" ? "move" : "default" }} onMouseDown={e => beginDragWallMove(el, e)} onTouchStart={e => beginDragWallMove(el, e)} />
            {planMode === "piso" && (() => {
              const canEdit = tool === "selecionar" && selectedId === el.id;
              const midX = (el.x1 + el.x2) / 2, midY = (el.y1 + el.y2) / 2;
              const angleDeg = labelAngleDeg(el);
              // The wall's own length label defaults to the wall's exact
              // midpoint — but so does a door/window's own size/type tag
              // whenever it sits there (a centered opening being the
              // common case), and both sit on the same "outward from the
              // room" side, landing right on top of each other. Keep the
              // label centered either way (moving it off-center reads as
              // wrong for a wall's overall length) and instead push it
              // further out along that same side, past the tag's own
              // reach, whenever an opening sits close enough to the
              // midpoint to collide. Compared in raw pixels, not a
              // fraction of the wall's own length — a short wall's own
              // 25%-of-length gap can still be narrower than two
              // overlapping text labels, while a long wall's never would,
              // so a fixed fraction threshold either over- or
              // under-triggers depending on the wall's length.
              const wdx = el.x2 - el.x1, wdy = el.y2 - el.y1, wlen = Math.hypot(wdx, wdy) || 1;
              const opensPx = elements
                .filter(o => (o.type === "door" || o.type === "window") && o.wallId === el.id)
                .map(o => ((o.x - el.x1) * wdx + (o.y - el.y1) * wdy) / wlen);
              const COLLIDE_PX = 45;
              const collides = opensPx.some(p => Math.abs(p - wlen * 0.5) < COLLIDE_PX);
              const off = wallLabelOffset(el, collides ? 20 : 0);
              const lx = midX + off.x, ly = midY + off.y;
              return (
                <text x={lx} y={ly} fontSize="10" fill={phaseColor(el) || "#6b6660"} textAnchor="middle"
                  transform={`rotate(${angleDeg} ${lx} ${ly})`}
                  style={{ pointerEvents: canEdit ? "auto" : "none", cursor: canEdit ? "pointer" : undefined }}
                  onClick={canEdit ? (e => { e.stopPropagation(); setEditingWallLen({ wallId: el.id, value: el.length }); }) : undefined}>
                  {el.length} m{canEdit && " ✎"}
                </text>
              );
            })()}
            {planMode === "piso" && wallDimensions(el)}
            {selectedId === el.id && tool === "selecionar" && (
              <>
                <circle cx={el.x1} cy={el.y1} r="6" fill="#726F68" stroke="#1B1E1A" strokeWidth="1" style={{ cursor: "grab" }}
                  onMouseDown={e => beginDragWallEndpoint(el, "start", e)} onTouchStart={e => beginDragWallEndpoint(el, "start", e)}
                  onClick={e => { e.stopPropagation(); setEditingWallLen({ wallId: el.id, value: el.length, movingEnd: "start" }); }} />
                <circle cx={el.x2} cy={el.y2} r="6" fill="#726F68" stroke="#1B1E1A" strokeWidth="1" style={{ cursor: "grab" }}
                  onMouseDown={e => beginDragWallEndpoint(el, "end", e)} onTouchStart={e => beginDragWallEndpoint(el, "end", e)}
                  onClick={e => { e.stopPropagation(); setEditingWallLen({ wallId: el.id, value: el.length, movingEnd: "end" }); }} />
              </>
            )}
          </g>
        ))}
        {planMode === "piso" && (tool === "parede" || tool === "escada" || tool === "ambiente") && (() => {
          // Visible snap targets for every wall/stair corner while drawing
          // or tracing — makes the (otherwise invisible) endpoint-snap
          // something the user can actually aim for, instead of hoping a
          // freehand tap lands close enough to it.
          const pts = [];
          elements.forEach(e => {
            if (e.type !== "wall" && e.type !== "stair") return;
            pts.push({ x: e.x1, y: e.y1, id: e.id + "-1" }, { x: e.x2, y: e.y2, id: e.id + "-2" });
          });
          return pts.map(pt => (
            <circle key={pt.id} cx={pt.x} cy={pt.y} r="4" fill="none" stroke="#2E6FED" strokeWidth="1.5" opacity="0.8" pointerEvents="none" />
          ));
        })()}
        {planMode === "piso" && nearestParallelWallDims(elements.filter(el => el.type === "wall")).map(d => {
          const dx = d.x2 - d.x1, dy = d.y2 - d.y1, len = Math.hypot(dx, dy) || 1;
          const ux = dx / len, uy = dy / len;
          const nx = -uy, ny = ux;
          const wallA = wallsById[d.aId], wallB = wallsById[d.bId];
          const halfThickAPx = wallA ? (wallThicknessM(wallA.wallType) / 2 / scale) * GRID : 0;
          const halfThickBPx = wallB ? (wallThicknessM(wallB.wallType) / 2 / scale) * GRID : 0;
          // Manual nudge, free in the plane of the line: perpendicular to it
          // (nx,ny — parallel to the walls themselves) and along it (ux,uy).
          // Persisted on the wall (not local state) so it survives this
          // component remounting on tab switch, and each axis is clamped
          // independently so it can't be dragged out of the room.
          const dimNudge = readDimNudge(wallA, d.bId);
          const maxPerp = Math.max(0, (d.overlapMax - d.overlapMin) / 2 - GRID);
          const perp = Math.max(-maxPerp, Math.min(maxPerp, dimNudge.perp));
          // The line itself must land on the walls' facing FACES, not their
          // centerlines (d.x1/d.y1 -> d.x2/d.y2 above) — pull each end in by
          // that wall's own half-thickness along the line. The perpendicular
          // nudge (sx,sy) shifts the WHOLE measuring line sideways along the
          // walls, not just its label — by default, two dimensions in a
          // rectangular room both cross through the room's center, forming a
          // cluttered "+"; this lets each one be pulled toward whichever
          // side of the room actually has room for it.
          const sx = nx * perp, sy = ny * perp;
          const fx1 = d.x1 + ux * halfThickAPx + sx, fy1 = d.y1 + uy * halfThickAPx + sy;
          const fx2 = d.x2 - ux * halfThickBPx + sx, fy2 = d.y2 - uy * halfThickBPx + sy;
          // For a simple rectangular room, this pair's line (running between
          // a wall and its opposite) and the OTHER pair's line (the two side
          // walls) cross exactly at the room's center — putting both labels
          // at their line's true midpoint then lands them on the exact same
          // point, stacking the two texts unreadably on top of each other.
          // Sliding each label off-center by a different amount depending on
          // whether its line runs mostly vertically or mostly horizontally
          // keeps it visually anchored to its own dimension line while
          // reliably landing the two labels somewhere different.
          const labelT = Math.abs(uy) > Math.abs(ux) ? 0.36 : 0.64;
          const midX = fx1 + (fx2 - fx1) * labelT, midY = fy1 + (fy2 - fy1) * labelT;
          const halfSumM = wallA && wallB ? (wallThicknessM(wallA.wallType) / 2 + wallThicknessM(wallB.wallType) / 2) : 0;
          const faceDistM = Math.max(0, pxToMeters(d.distPx) - halfSumM).toFixed(2);
          const faceLen = Math.hypot(fx2 - fx1, fy2 - fy1) || 1;
          // A second, smaller degree of freedom along the line itself (ux,uy)
          // slides the label between the two wall faces instead of always
          // sitting at the fixed labelT point — useful once the line's own
          // position no longer forces it away from an opening or another label.
          const alongMargin = Math.min(10, faceLen / 2);
          const alongLo = Math.min(alongMargin - faceLen * labelT, faceLen - alongMargin - faceLen * labelT);
          const alongHi = Math.max(alongMargin - faceLen * labelT, faceLen - alongMargin - faceLen * labelT);
          const along = Math.max(alongLo, Math.min(alongHi, dimNudge.along));
          const labelX = midX + ux * along, labelY = midY + uy * along;
          // Rotate the label to read parallel to its own dimension line
          // (matching standard architectural dimension convention) instead
          // of always horizontal — flipped 180° whenever the raw angle
          // would otherwise render the text upside down, same as a wall's
          // own length label.
          let dimDeg = Math.atan2(uy, ux) * 180 / Math.PI;
          if (dimDeg > 90 || dimDeg < -90) dimDeg += 180;
          // Which wall of the pair moves when this dimension is edited: keep
          // whichever one is already selected (so editing right after
          // selecting a wall moves that same wall, not its neighbor), else
          // default to A — either way the dimension itself is always
          // clickable, not just when one of its two walls happens to already
          // be selected (that made most dimensions in a room look editable
          // but silently do nothing when clicked).
          const movingWallId = selectedId === d.bId ? d.bId : d.aId;
          const fixedWallId = movingWallId === d.aId ? d.bId : d.aId;
          const editable = tool === "selecionar";
          const isEditing = editingParallelDim && editingParallelDim.movingWallId === movingWallId
            && editingParallelDim.fixedWallId === fixedWallId;
          const startEdit = () => { setSelectedId(movingWallId); setEditingParallelDim({ movingWallId, fixedWallId, value: faceDistM }); };
          return (
            <g key={`pw-${d.aId}-${d.bId}`} opacity="0.9">
              <line x1={fx1} y1={fy1} x2={fx2} y2={fy2} stroke={dimColor} strokeWidth="0.9" pointerEvents="none" />
              <line x1={fx1 - nx * 4} y1={fy1 - ny * 4} x2={fx1 + nx * 4} y2={fy1 + ny * 4} stroke={dimColor} strokeWidth="0.9" pointerEvents="none" />
              <line x1={fx2 - nx * 4} y1={fy2 - ny * 4} x2={fx2 + nx * 4} y2={fy2 + ny * 4} stroke={dimColor} strokeWidth="0.9" pointerEvents="none" />
              <g transform={dimDeg ? `rotate(${dimDeg} ${labelX} ${labelY})` : undefined}>
                {editable && (
                  // Bigger than the visible pill below it — a touch-friendly
                  // hit area around a small label is worth more than visual
                  // purity here, especially with several dimensions crowded
                  // into a small room. Mousedown/touchstart (not onClick) so
                  // it can double as the handle for the free 2D drag above —
                  // a plain tap (no movement) still falls through to
                  // startEdit via onDimLabelDragEnd, same as the room-name
                  // label pattern.
                  <rect x={labelX - 22} y={labelY - 14} width="44" height="28" fill={isEditing ? dimColor : "transparent"} opacity={isEditing ? 0.3 : 1}
                    style={{ cursor: "move" }}
                    onMouseDown={e => wallA && beginDragDimLabel(wallA, d.bId, ux, uy, nx, ny, d.overlapMin, d.overlapMax, faceLen, labelT, startEdit, e)}
                    onTouchStart={e => wallA && beginDragDimLabel(wallA, d.bId, ux, uy, nx, ny, d.overlapMin, d.overlapMax, faceLen, labelT, startEdit, e)} />
                )}
                <rect x={labelX - 15} y={labelY - 7} width="30" height="10" fill="#DCDCD8" opacity="0.85" pointerEvents="none" />
                <text x={labelX} y={labelY + 1} fontSize="8" fill={dimColor} textAnchor="middle" fontWeight="600"
                  style={{ pointerEvents: "none" }}>{faceDistM} m</text>
              </g>
            </g>
          );
        })}
        {planMode === "piso" && elements.filter(el => el.type === "stair").map(el => (
          <g key={el.id}>
            <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={selectedId === el.id ? "#726F68" : "#6B6862"} strokeWidth="10" strokeLinecap="round" opacity="0.7"
              style={{ cursor: tool === "selecionar" ? "move" : "default" }} onMouseDown={e => beginDragWallMove(el, e)} onTouchStart={e => beginDragWallMove(el, e)} />
            {el.hasLanding && <circle cx={el.x1 + (el.x2 - el.x1) * toNum(el.landingPos, 0.5)} cy={el.y1 + (el.y2 - el.y1) * toNum(el.landingPos, 0.5)} r="9" fill="none" stroke="#4A4A46" strokeWidth="1.5" />}
            {Array.from({ length: 5 }).map((_, i) => {
              const t = (i + 1) / 6;
              const x = el.x1 + (el.x2 - el.x1) * t, y = el.y1 + (el.y2 - el.y1) * t;
              return <line key={i} x1={x - 5} y1={y - 5} x2={x + 5} y2={y + 5} stroke="#4A4A46" strokeWidth="1.5" />;
            })}
            <text x={(el.x1 + el.x2) / 2} y={(el.y1 + el.y2) / 2 - 10} fontSize="9" fill="#4A4A46" textAnchor="middle">{el.tag}</text>
          </g>
        ))}
        {planMode === "piso" && elements.filter(el => el.type === "door" || el.type === "window").map(el => {
          const w = wallsById[el.wallId];
          const angleDeg = w ? (Math.atan2(w.y2 - w.y1, w.x2 - w.x1) * 180 / Math.PI) : 0;
          const widthPx = Math.max(6, (toNum(el.width, 0.8) / scale) * GRID);
          const isDoor = el.type === "door";
          const isSel = selectedId === el.id;
          const panels = Math.max(1, Math.round(toNum(el.panels, isDoor ? 1 : 2)));
          const panelWidthPx = widthPx / panels;
          return (
            <g key={el.id} transform={`rotate(${angleDeg} ${el.x} ${el.y})`}>
              <rect x={el.x - widthPx / 2 - 4} y={el.y - 14} width={widthPx + 8} height={28} fill="rgba(0,0,0,0.001)"
                style={{ cursor: tool === "selecionar" ? "grab" : "default" }} onMouseDown={e => beginDragOpening(el, e)} onTouchStart={e => beginDragOpening(el, e)} />
              <rect x={el.x - widthPx / 2} y={el.y - 3.5} width={widthPx} height={7}
                fill={el.demolir ? "rgba(193,84,63,0.35)" : el.construir ? "rgba(107,156,90,0.35)" : (isDoor ? "#4A4A46" : "#B9B6AE")}
                stroke={isSel ? "#726F68" : phaseColor(el) || "#1B1E1A"} strokeWidth={isSel ? 2.5 : 1}
                strokeDasharray={phaseColor(el) ? "3,2" : undefined}
                opacity={isDoor ? 1 : 0.85}
                style={{ pointerEvents: "none" }} />
              {Array.from({ length: panels - 1 }).map((_, i) => (
                <line key={i} x1={el.x - widthPx / 2 + panelWidthPx * (i + 1)} y1={el.y - 3.5}
                  x2={el.x - widthPx / 2 + panelWidthPx * (i + 1)} y2={el.y + 3.5}
                  stroke="#1B1E1A" strokeWidth="1" style={{ pointerEvents: "none" }} />
              ))}
              <text x={el.x} y={el.y - 14} fontSize="9" fill={phaseColor(el) || "#6b6660"} textAnchor="middle" transform={`rotate(${-angleDeg} ${el.x} ${el.y - 14})`}>{el.width}×{el.height} · {panels}f</text>
            </g>
          );
        })}
        {planMode === "forro" && elements.filter(el => el.type === "luminaria").map(el => {
          const dims = tool === "selecionar" ? luminariaDimensions(el) : null;
          return (
            <g key={el.id}>
              {dims?.wallDim && (
                <g>
                  <line x1={el.x} y1={el.y} x2={dims.wallDim.target.x} y2={dims.wallDim.target.y} stroke="#8A8880" strokeWidth="0.75" strokeDasharray="3,2" />
                  <text x={(el.x + dims.wallDim.target.x) / 2} y={(el.y + dims.wallDim.target.y) / 2 - 4} fontSize="7.5" fill="#4A4A46" textAnchor="middle"
                    style={{ cursor: "pointer" }} onClick={e => { e.stopPropagation(); setEditingLumDim({ lumId: el.id, kind: "wall", refX: dims.wallDim.target.x, refY: dims.wallDim.target.y, value: pxToMeters(dims.wallDim.d) }); }}>
                    {pxToMeters(dims.wallDim.d)} ✎
                  </text>
                </g>
              )}
              {dims?.lumDim && (
                <g>
                  <line x1={el.x} y1={el.y} x2={dims.lumDim.target.x} y2={dims.lumDim.target.y} stroke="#B9B6AE" strokeWidth="0.75" strokeDasharray="1,3" />
                  <text x={(el.x + dims.lumDim.target.x) / 2} y={(el.y + dims.lumDim.target.y) / 2 + 8} fontSize="7.5" fill="#6B6862" textAnchor="middle"
                    style={{ cursor: "pointer" }} onClick={e => { e.stopPropagation(); setEditingLumDim({ lumId: el.id, kind: "lum", refX: dims.lumDim.target.x, refY: dims.lumDim.target.y, value: pxToMeters(dims.lumDim.d) }); }}>
                    {pxToMeters(dims.lumDim.d)} ✎
                  </text>
                </g>
              )}
              <circle cx={el.x} cy={el.y} r="6" fill="#E5E3DD" stroke={selectedId === el.id ? "#726F68" : "#4A4A46"} strokeWidth={selectedId === el.id ? 2.5 : 1} />
              <line x1={el.x - 8} y1={el.y} x2={el.x + 8} y2={el.y} stroke="#4A4A46" strokeWidth="1" />
              <line x1={el.x} y1={el.y - 8} x2={el.x} y2={el.y + 8} stroke="#4A4A46" strokeWidth="1" />
            </g>
          );
        })}
        {polygon.length > 0 && <polyline points={polygon.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#4A4A46" strokeWidth="1.5" strokeDasharray="4,3" />}
        {polygon.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="#4A4A46" />)}
        {pending && <circle cx={pending.x} cy={pending.y} r="4.5" fill="#4A4A46" stroke="#1B1E1A" strokeWidth="1" />}
      </svg>

      {selected && (
        <div className="mt-2 p-2.5 rounded-lg" style={{ background: C.goldTint, border: `1px solid ${C.gold}` }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-medium" style={{ color: C.gold }}>
              {selected.type === "wall" ? `Parede ${selected.tag}` : selected.type === "door" ? `Porta ${selected.tag}` : selected.type === "window" ? `Janela ${selected.tag}` : selected.type === "room" ? `Ambiente: ${selected.name || "sem nome"}` : selected.type === "stair" ? `Escada ${selected.tag}` : "Luminária"}
            </span>
            <button onClick={() => setSelectedId(null)}><X size={14} color={C.gold} /></button>
          </div>

          {selected.type === "wall" && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap text-[11px]" style={{ color: C.chalk }}>
                <NumField value={selected.length} onCommit={v => setWallLengthDirect(selected.id, v)} unit="m comprimento" />
                <NumField value={selected.height} onChange={v => patchSelected({ height: v })} unit="m altura" />
                <ConditionSelect value={selected.condition} onChange={v => patchSelected({ condition: v })} />
                <PhaseToggles demolir={selected.demolir} construir={selected.construir} onChange={patchSelected} />
              </div>
              {findMergeableWall(selected, elements) && (
                <button onClick={tryMergeSelected} className="flex items-center gap-1 text-[11px] px-2 py-1.5 rounded" style={{ ...heading, fontWeight: 600, background: C.gold, color: "#141311" }}>
                  <Link2 size={12} /> Unir com parede adjacente (mesmo alinhamento)
                </button>
              )}
              {findCornerWall(selected, elements) && (
                <button onClick={tryTrimCorner} className="flex items-center gap-1 text-[11px] px-2 py-1.5 rounded" style={{ ...heading, fontWeight: 600, background: C.gold, color: "#141311" }}>
                  <CornerUpRight size={12} /> Aparar/unir canto com parede próxima
                </button>
              )}
              {!splittingWall ? (
                <button onClick={() => setSplittingWall({ value: (toNum(selected.length) / 2).toFixed(2) })} className="flex items-center gap-1 text-[11px] px-2 py-1.5 rounded" style={{ ...heading, fontWeight: 600, background: C.panelAlt, color: C.chalk, border: `1px solid ${C.line}` }}>
                  <Scissors size={12} /> Cortar parede...
                </button>
              ) : (
                <div className="flex items-center gap-2 flex-wrap p-2 rounded" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <span className="text-[11px]" style={{ color: C.mute }}>Cortar a</span>
                  <input autoFocus type="text" inputMode="decimal" value={splittingWall.value} onChange={e => setSplittingWall({ value: e.target.value })}
                    onKeyDown={e => e.key === "Enter" && splitSelectedWallAt(splittingWall.value)}
                    className="w-16 px-1.5 py-1 rounded text-[11px] text-right" style={{ ...mono, background: "rgba(255,255,255,0.08)", color: C.chalk, border: `1px solid ${C.line}` }} />
                  <span className="text-[11px]" style={{ color: C.mute }}>m do início (parede tem {selected.length} m)</span>
                  <button onClick={() => splitSelectedWallAt(splittingWall.value)} className="text-[11px] px-2 py-1 rounded" style={{ ...heading, fontWeight: 600, background: C.gold, color: "#141311" }}>Cortar</button>
                  <button onClick={() => setSplittingWall(null)} style={{ color: C.mute }}><X size={13} /></button>
                </div>
              )}
            </div>
          )}
          {(selected.type === "door" || selected.type === "window") && (
            <div className="flex items-center gap-2 flex-wrap text-[11px]">
              <span style={{ color: C.mute }}>Família:</span>
              {selected.type === "door"
                ? <TypeSelect value={selected.doorType || DOOR_TYPES[0]} options={DOOR_TYPES} onChange={v => patchSelected({ doorType: v })} />
                : <TypeSelect value={selected.windowType || WINDOW_TYPES[0]} options={WINDOW_TYPES} onChange={v => patchSelected({ windowType: v })} />}
              <NumField value={selected.panels || 1} onChange={v => patchSelected({ panels: v })} unit="folhas" w="w-10" />
              <PhaseToggles demolir={selected.demolir} construir={selected.construir} onChange={patchSelected} />
            </div>
          )}
          {(selected.type === "door" || selected.type === "window") && (
            <div className="flex items-center gap-2 flex-wrap text-[11px] mt-1.5">
              <span style={{ color: C.mute }}>Posição na parede:</span>
              <NumField value={openingPosM(selected)} onCommit={v => moveOpeningAlongWall(selected, toNum(v, 0))} unit="m do início" />
              <NumField value={selected.width} onChange={v => patchSelected({ width: v })} unit="larg." />
              <NumField value={selected.height} onChange={v => patchSelected({ height: v })} unit="alt." />
              {selected.type === "window" && <NumField value={selected.peitoril} onChange={v => patchSelected({ peitoril: v })} unit="peitoril" />}
            </div>
          )}
          {selected.type === "room" && (
            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span style={{ color: C.mute }}>Piso:</span>
                <TypeSelect value={selected.floorFinish || "A definir"} options={FLOOR_TYPES} onChange={v => patchSelected({ floorFinish: v })} />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span style={{ color: C.mute }}>Forro:</span>
                <TypeSelect value={selected.ceilingFinish || "A definir"} options={CEILING_TYPES} onChange={v => patchSelected({ ceilingFinish: v })} />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button onClick={() => { setNamingId(selected.id); setNamingValue(selected.name || ""); }} className="flex items-center gap-1 px-2 py-1 rounded" style={{ ...heading, fontWeight: 600, background: C.goldTint, color: C.gold, border: `1px solid ${C.gold}` }}>
                  <Pencil size={11} /> Renomear
                </button>
                <button onClick={() => rotateRoomLabel(selected)} className="flex items-center gap-1 px-2 py-1 rounded" style={{ ...heading, fontWeight: 600, background: C.panelAlt, color: C.chalk, border: `1px solid ${C.line}` }}>
                  <RotateCcw size={11} /> Girar {planMode === "forro" ? "forro" : "nome"} 90° (arraste pra reposicionar)
                </button>
              </div>
            </div>
          )}
          {selected.type === "stair" && (
            <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
              <span style={{ color: C.mute }}>Sobe até:</span>
              <select value={selected.toLevelId || ""} onChange={e => patchSelected({ toLevelId: e.target.value })} className="text-[11px] px-1.5 py-1 rounded"
                style={{ background: "rgba(255,255,255,0.08)", color: C.chalk, border: `1px solid ${C.line}` }}>
                <option value="">— selecione —</option>
                {(allLevels || []).filter(l => l.id !== level.id).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <NumField value={selected.width} onChange={v => patchSelected({ width: v })} unit="m largura" />
              <label className="flex items-center gap-1 w-full mt-1">
                <input type="checkbox" checked={!!selected.hasLanding} onChange={e => {
                  if (e.target.checked) {
                    const target = (allLevels || []).find(l => l.id === selected.toLevelId);
                    const totalRise = target ? (toNum(target.elevation) - toNum(level.elevation)) : 3;
                    patchSelected({ hasLanding: true, landingPos: 0.5, landingHeight: (totalRise * 0.5).toFixed(2) });
                  } else {
                    patchSelected({ hasLanding: false });
                  }
                }} />
                <span style={{ color: C.mute }}>Tem patamar</span>
              </label>
              {selected.hasLanding && (
                <>
                  <NumField value={selected.landingPos} onChange={v => patchSelected({ landingPos: Math.min(0.95, Math.max(0.05, toNum(v, 0.5))) })} unit="posição (0 a 1 no trajeto)" />
                  <NumField value={selected.landingHeight} onChange={v => patchSelected({ landingHeight: v })} unit="m — altura do patamar até o piso" />
                </>
              )}
            </div>
          )}
          <button onClick={() => {
            const ids = new Set([selected.id, ...(selected.type === "wall" ? elements.filter(e => (e.type === "door" || e.type === "window") && e.wallId === selected.id).map(e => e.id) : [])]);
            setDeletedStack(s => [...s, elements.filter(e => ids.has(e.id))]);
            commitElements(elements.filter(e => !ids.has(e.id)));
            setSelectedId(null);
          }} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded mt-2" style={{ color: C.bad, background: "rgba(193,84,63,0.12)" }}>
            <Trash2 size={11} /> Apagar este elemento
          </button>
        </div>
      )}

      <div className="flex items-center justify-end mt-2 flex-wrap gap-2">
        <div className="flex gap-1.5">
          <button onClick={undoLast} className="flex items-center gap-1 text-[11px] px-2 py-1.5 rounded" style={{ ...heading, fontWeight: 600, background: C.panelAlt, color: C.chalk, border: `1px solid ${C.line}` }}>
            <Undo2 size={12} /> Recente
          </button>
          <button onClick={restoreLast} disabled={!deletedStack.length}
            className="flex items-center gap-1 text-[11px] px-2 py-1.5 rounded"
            style={{ ...heading, fontWeight: 600, background: deletedStack.length ? C.goldTint : C.panelAlt, color: deletedStack.length ? C.gold : C.muteDim, border: `1px solid ${deletedStack.length ? C.gold : C.line}`, opacity: deletedStack.length ? 1 : 0.5 }}>
            <RotateCcw size={12} /> Desfazer exclusão
          </button>
          <button onClick={clearAll} className="flex items-center gap-1 text-[11px] px-2 py-1.5 rounded" style={{ ...heading, fontWeight: 600, background: C.panelAlt, color: C.bad, border: `1px solid ${C.line}` }}>
            <Eraser size={12} /> Tudo
          </button>
        </div>
      </div>
    </div>
  );
}
