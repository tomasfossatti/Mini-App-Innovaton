import { describe, expect, it } from "vitest";
import { phoneMatches } from "@/lib/domain/search";

const STORED = "+5493511234567";

describe("phoneMatches", () => {
  it("encuentra el número en los formatos argentinos habituales", () => {
    for (const q of ["0351 15 123-4567", "351 15 1234567", "+54 9 351 123 4567", "3511234567", "1234567", "4567"]) {
      expect(phoneMatches(STORED, q), q).toBe(true);
    }
  });
  it("no coincide con otro número ni con muy pocos dígitos", () => {
    expect(phoneMatches(STORED, "0351 15 765-4321")).toBe(false);
    expect(phoneMatches(STORED, "45")).toBe(false);
    expect(phoneMatches(STORED, "ana")).toBe(false);
  });
  it("con teléfonos enmascarados compara solo los últimos 4", () => {
    const masked = "•••• 4567";
    expect(phoneMatches(masked, "0351 15 123-4567", { masked: true })).toBe(true);
    expect(phoneMatches(masked, "4567", { masked: true })).toBe(true);
    expect(phoneMatches(masked, "567", { masked: true })).toBe(true);
    expect(phoneMatches(masked, "0351 15 123-9999", { masked: true })).toBe(false);
  });
});
