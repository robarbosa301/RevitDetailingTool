import { describe, it, expect } from "vitest";
import { toNum } from "./utils.js";

describe("toNum", () => {
  it("parses plain numbers", () => {
    expect(toNum("12.5")).toBe(12.5);
    expect(toNum(7)).toBe(7);
  });

  it("accepts comma as a decimal separator (pt-BR input)", () => {
    expect(toNum("2,80")).toBe(2.8);
  });

  it("falls back for empty/nullish input", () => {
    expect(toNum("")).toBe(0);
    expect(toNum(null)).toBe(0);
    expect(toNum(undefined)).toBe(0);
    expect(toNum(null, 5)).toBe(5);
  });

  it("falls back for unparseable input", () => {
    expect(toNum("abc", 3)).toBe(3);
  });
});
