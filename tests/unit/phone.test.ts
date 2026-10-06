import { describe, expect, it } from "vitest";
import { WHATSAPP_ERROR, normalizeWhatsapp, waLink } from "@/lib/domain/phone";

function e164Of(input: string): string | null {
  const result = normalizeWhatsapp(input);
  return result.ok ? result.e164 : null;
}

describe("normalizeWhatsapp — Argentina", () => {
  const cordoba = [
    "351 1234567",
    "0351 15 123 4567",
    "0351-15-1234567",
    "+54 9 351 123 4567",
    "+5493511234567",
    "5493511234567",
    "(351) 15-123-4567",
    "+54 351 1234567",
    "543511234567",
    "  351 1234567  ",
    "00 54 9 351 1234567",
    // Con el 9 y el 15 a la vez.
    "+54 9 351 15 123 4567",
    "+549 351 15 1234567",
  ];

  it.each(cordoba)("%s → +5493511234567", (input) => {
    expect(e164Of(input)).toBe("+5493511234567");
  });

  const buenosAires = [
    "11 1234 5678",
    "011 15 1234-5678",
    "+54 11 1234 5678",
    "+54 9 11 1234 5678",
    "+54 9 11 15 1234 5678",
  ];

  it.each(buenosAires)("%s → +5491112345678", (input) => {
    expect(e164Of(input)).toBe("+5491112345678");
  });

  it("todos los móviles AR quedan como +549 + 10 dígitos", () => {
    for (const input of [...cordoba, ...buenosAires, "0223 15 412-3456", "02901 15 12-3456"]) {
      expect(e164Of(input)).toMatch(/^\+549\d{10}$/);
    }
  });

  it("los formatos de la especificación dan el mismo número", () => {
    const spec = ["351 1234567", "0351 15 123 4567", "0351-15-1234567", "+54 9 351 123 4567"];
    const more = ["+5493511234567", "5493511234567", "(351) 15-123-4567"];
    expect(new Set([...spec, ...more].map(e164Of))).toEqual(new Set(["+5493511234567"]));
    const ba = ["11 1234 5678", "011 15 1234-5678", "+54 11 1234 5678"];
    expect(new Set(ba.map(e164Of))).toEqual(new Set(["+5491112345678"]));
  });

  it("áreas de 4 dígitos con y sin 15", () => {
    for (const input of ["03543 15 123456", "3543 15 123456", "3543 123456", "+54 9 3543 123456"]) {
      expect(e164Of(input)).toBe("+5493543123456");
    }
  });

  it("tolera separadores de copiar y pegar (tab, salto de línea, espacios duros, marcas invisibles)", () => {
    const pasted = [
      "351\t1234567",
      "+54 9 351\r\n123 4567",
      "+54\u00a09\u00a0351\u00a0123-4567",
      "+54\u202f9\u202f351\u202f123\u20114567",
      "\u202d+54 9 351 123-4567\u202c",
    ];
    for (const input of pasted) expect(e164Of(input)).toBe("+5493511234567");
  });

  it("el display de un móvil AR siempre empieza con +54 9", () => {
    for (const input of [...cordoba, ...buenosAires]) {
      const result = normalizeWhatsapp(input);
      expect(result.ok && result.display.startsWith("+54 9 ")).toBe(true);
    }
  });

  it("devuelve display legible y waNumber sin +", () => {
    const result = normalizeWhatsapp("0351 15 123 4567");
    expect(result).toEqual({
      ok: true,
      e164: "+5493511234567",
      display: "+54 9 351 123 4567",
      waNumber: "5493511234567",
    });
  });
});

describe("normalizeWhatsapp — internacionales", () => {
  it("acepta números válidos con +", () => {
    expect(normalizeWhatsapp("+34 612 34 56 78")).toEqual({
      ok: true,
      e164: "+34612345678",
      display: "+34 612 34 56 78",
      waNumber: "34612345678",
    });
    expect(normalizeWhatsapp("+1 415 555 2671")).toMatchObject({
      ok: true,
      e164: "+14155552671",
      waNumber: "14155552671",
    });
    expect(e164Of("+598 99 123 456")).toBe("+59899123456");
  });

  it("respeta el país por defecto cuando se indica otro", () => {
    expect(normalizeWhatsapp("099 123 456", "UY")).toMatchObject({ ok: true, e164: "+59899123456" });
  });
});

describe("normalizeWhatsapp — inválidos", () => {
  const invalid = [
    "",
    "   ",
    "123",
    "abc",
    "0351",
    "351 123456", // le falta un dígito
    "15 1234 5678", // sin código de área
    "+54 9 351 1234567 8", // le sobra un dígito
    "351-123-4567 int. 12",
    "0800 123 4567", // no geográfico: no puede ser WhatsApp
    "0810 123 4567",
    "+54 9 800 123 4567", // no geográfico, aunque venga con el 9
    "+54 9 600 123 4567",
    "+54 9 15 1234 5678", // celular de AMBA sin el 11: no existe el área 15
    "+54 9 10 1234 5678",
    "+54 15 1234 5678",
    "+34 123",
  ];

  it.each(invalid)("%j → error", (input) => {
    expect(normalizeWhatsapp(input)).toEqual({ ok: false, error: WHATSAPP_ERROR });
  });

  it("el mensaje de error es breve y en español", () => {
    expect(WHATSAPP_ERROR).toBe("Revisá el número de WhatsApp (incluí el código de área).");
  });
});

describe("waLink", () => {
  it("arma el link sin texto", () => {
    expect(waLink("5493511234567")).toBe("https://wa.me/5493511234567");
  });

  it("codifica el texto precargado", () => {
    expect(waLink("5493511234567", "Hola, ¿todo bien? Te esperamos a las 14:20 & listo")).toBe(
      "https://wa.me/5493511234567?text=Hola%2C%20%C2%BFtodo%20bien%3F%20Te%20esperamos%20a%20las%2014%3A20%20%26%20listo",
    );
  });

  it("ignora texto vacío y limpia caracteres que no son dígitos", () => {
    expect(waLink("+54 9 351 123-4567", "")).toBe("https://wa.me/5493511234567");
  });

  it("funciona con el resultado de normalizeWhatsapp", () => {
    const result = normalizeWhatsapp("0351-15-1234567");
    if (!result.ok) throw new Error("debería normalizar");
    expect(waLink(result.waNumber)).toBe("https://wa.me/5493511234567");
  });
});
