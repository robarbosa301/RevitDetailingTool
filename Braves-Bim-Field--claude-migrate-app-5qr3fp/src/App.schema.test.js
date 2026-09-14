import { describe, it, expect } from "vitest";
import {
  composeAddress,
  wallToM,
  doorToM,
  windowToM,
  levelToMeters,
  buildLevantamentoSchema,
} from "./App.jsx";
import { conditionColor, phaseColor } from "./theme.js";
import { wallThicknessM } from "./constants.js";

describe("wallThicknessM", () => {
  it("looks up known wall types", () => {
    expect(wallThicknessM("Alvenaria 15cm")).toBe(0.15);
    expect(wallThicknessM("Drywall")).toBe(0.10);
  });

  it("falls back to 0.15 for an unknown/missing type", () => {
    expect(wallThicknessM("???")).toBe(0.15);
    expect(wallThicknessM(undefined)).toBe(0.15);
  });
});

describe("conditionColor / phaseColor", () => {
  it("gives a distinct color per condition and falls back to muted for unset", () => {
    expect(conditionColor("Bom")).not.toBe(conditionColor("Ruim"));
    expect(conditionColor("A confirmar")).not.toBe(conditionColor("Bom"));
  });

  it("prioritizes demolir over construir when (invalidly) both are set", () => {
    expect(phaseColor({ demolir: true, construir: true })).toBe(phaseColor({ demolir: true }));
  });

  it("returns null (no phase override) for an untouched element", () => {
    expect(phaseColor({})).toBeNull();
  });
});

describe("composeAddress", () => {
  it("joins the pieces it has and skips the ones it doesn't", () => {
    expect(composeAddress({ street: "Rua A", number: "10", neighborhood: "Centro", city: "Atlanta", state: "GA" }))
      .toBe("Rua A, 10 — Centro, Atlanta, GA");
  });

  it("handles a partially-filled address", () => {
    expect(composeAddress({ city: "Atlanta" })).toBe("Atlanta");
  });

  it("returns an empty string for no address at all", () => {
    expect(composeAddress(null)).toBe("");
    expect(composeAddress({})).toBe("");
  });
});

// toM here mimics levelToMeters's own px->m conversion (GRID=20, scale=0.5)
// so tests can check the conversion math without duplicating its internals.
const toM = (px) => (px / 20) * 0.5;

describe("wallToM / doorToM / windowToM", () => {
  it("converts a wall's pixel coordinates to meters and keeps its reforma flags", () => {
    const w = wallToM({ id: "w1", x1: 0, y1: 0, x2: 100, y2: 0, wallType: "Concreto", demolir: true }, toM);
    expect(w.x2).toBeCloseTo(2.5, 6); // 100px / 20 * 0.5
    expect(w.wallType).toBe("Concreto");
    expect(w.demolir).toBe(true);
    expect(w.construir).toBe(false);
  });

  it("applies sensible defaults for a bare-minimum wall", () => {
    const w = wallToM({ id: "w1", x1: 0, y1: 0, x2: 0, y2: 0 }, toM);
    expect(w.height).toBe(2.8);
    expect(w.condition).toBe("A confirmar");
    expect(w.finishA).toBe("A definir");
  });

  it("converts a door's position and coerces numeric fields", () => {
    const d = doorToM({ id: "d1", x: 40, y: 0, width: "0,90", panels: "1" }, toM);
    expect(d.x).toBeCloseTo(1, 6);
    expect(d.width).toBeCloseTo(0.9, 6);
    expect(d.panels).toBe(1);
  });

  it("converts a window and rounds panels to the nearest integer", () => {
    const win = windowToM({ id: "j1", x: 0, y: 0, panels: 1.6 }, toM);
    expect(win.panels).toBe(2);
  });
});

describe("levelToMeters", () => {
  it("buckets sketch elements by type and converts each to meters", () => {
    const level = {
      elevation: "3.10",
      sketchScale: 0.5,
      sketchElements: [
        { type: "wall", id: "w1", x1: 0, y1: 0, x2: 100, y2: 0 },
        { type: "door", id: "d1", wallId: "w1", x: 40, y: 0 },
      ],
    };
    const m = levelToMeters(level);
    expect(m.elevation).toBe(3.1);
    expect(m.walls).toHaveLength(1);
    expect(m.doors).toHaveLength(1);
    expect(m.windows).toHaveLength(0);
  });
});

describe("buildLevantamentoSchema", () => {
  it("produces a schema_version 1 payload with the given levels/rooms nested inside", () => {
    const level = {
      id: "lvl1",
      name: "Térreo",
      elevation: "0.00",
      wallHeightDefault: "2.80",
      sketchScale: 0.5,
      sketchElements: [{ type: "wall", id: "w1", x1: 0, y1: 0, x2: 100, y2: 0, demolir: true }],
    };
    const schema = buildLevantamentoSchema({
      code: "7K2P",
      buildingInfo: { name: "Casa Teste" },
      rooms: [{ id: "r1", name: "Sala", level: "Térreo", area: 12.5 }],
      levels: [level],
      roofs: [],
    });

    expect(schema.schema_version).toBe(1);
    expect(schema.projeto.codigo).toBe("7K2P");
    expect(schema.projeto.nome).toBe("Casa Teste");
    expect(schema.niveis).toHaveLength(1);
    expect(schema.niveis[0].paredes).toHaveLength(1);
    expect(schema.niveis[0].paredes[0].demolir).toBe(true);
    expect(schema.ambientes).toHaveLength(1);
    expect(schema.ambientes[0].area_m2).toBe(12.5);
  });

  it("tolerates missing optional collections", () => {
    const schema = buildLevantamentoSchema({ code: "X", buildingInfo: null, rooms: null, levels: null, roofs: null });
    expect(schema.niveis).toEqual([]);
    expect(schema.ambientes).toEqual([]);
    expect(schema.coberturas).toEqual([]);
  });
});
