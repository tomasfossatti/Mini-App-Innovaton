import { describe, expect, it } from "vitest";
import { formatDate, formatIsoDate, formatTime, zonedDateTimeToUtc } from "@/lib/domain/time";

describe("time", () => {
  it("convierte hora local de Córdoba a UTC (UTC-3)", () => {
    const d = zonedDateTimeToUtc("2026-10-15", "14:20");
    expect(d.toISOString()).toBe("2026-10-15T17:20:00.000Z");
    expect(formatTime(d)).toBe("14:20");
    expect(formatIsoDate(d)).toBe("2026-10-15");
  });
  it("formatea la fecha en español", () => {
    expect(formatDate(new Date("2026-10-15T17:20:00.000Z"))).toBe("jueves, 15 de octubre");
  });
});
