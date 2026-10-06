import { describe, expect, it } from "vitest";
import { joinEs, namesLikelyMatch } from "@/lib/domain/text";

describe("joinEs", () => {
  it("une listas en español", () => {
    expect(joinEs([])).toBe("");
    expect(joinEs(["a"])).toBe("a");
    expect(joinEs(["a", "b"])).toBe("a y b");
    expect(joinEs(["a", "b", "c"])).toBe("a, b y c");
  });
});

describe("namesLikelyMatch", () => {
  it("compara la primera palabra sin tildes ni mayúsculas", () => {
    expect(namesLikelyMatch("María", "maria pérez")).toBe(true);
    expect(namesLikelyMatch("  JUAN  Gómez", "Juan")).toBe(true);
    expect(namesLikelyMatch("Juan", "María")).toBe(false);
    expect(namesLikelyMatch("", "María")).toBe(false);
  });
});
