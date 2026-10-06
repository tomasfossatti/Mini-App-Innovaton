import { describe, expect, it } from "vitest";
import { CAPABILITIES, MODES } from "@/lib/domain/constants";

describe("constants", () => {
  it("define 3 modos y 6 capacidades", () => {
    expect(MODES).toHaveLength(3);
    expect(CAPABILITIES).toHaveLength(6);
  });
});
