import { describe, expect, it } from "vitest";
import { standPhrase } from "@/lib/domain/copy";

describe("standPhrase", () => {
  it("usa el literal del PRD §13 con el lugar por defecto", () => {
    expect(`Volvé al ${standPhrase("Stand Espacio IDI")}`).toBe("Volvé al stand de Espacio IDI");
    expect(standPhrase("")).toBe("stand de Espacio IDI");
  });
  it("respeta un lugar definido por el evento", () => {
    expect(standPhrase("Pabellón B, stand 12")).toBe("Pabellón B, stand 12");
  });
});
