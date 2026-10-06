import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/domain/csv";

const BOM = "\uFEFF";

function noBom(rows: Parameters<typeof toCsv>[0], separator?: string): string {
  return toCsv(rows, { bom: false, separator });
}

describe("toCsv — formato", () => {
  it("agrega BOM por defecto y termina cada fila con CRLF", () => {
    expect(toCsv([["nombre", "equipo"], ["Ana", 2]])).toBe(`${BOM}nombre,equipo\r\nAna,2\r\n`);
  });

  it("el BOM es U+FEFF (EF BB BF en UTF-8)", () => {
    const csv = toCsv([["a"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect([...new TextEncoder().encode(csv).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("permite omitir el BOM", () => {
    expect(noBom([["a", "b"]])).toBe("a,b\r\n");
  });

  it("sin filas devuelve solo el BOM", () => {
    expect(toCsv([])).toBe(BOM);
    expect(noBom([])).toBe("");
  });

  it("usa el separador indicado", () => {
    expect(noBom([["a", "b;c", "d,e"]], ";")).toBe('a;"b;c";d,e\r\n');
  });

  it("rechaza separadores inválidos", () => {
    expect(() => noBom([["a"]], "")).toThrow();
    expect(() => noBom([["a"]], '"')).toThrow();
    expect(() => noBom([["a"]], "\n")).toThrow();
  });
});

describe("toCsv — escapes RFC 4180", () => {
  it("entrecomilla campos con separador, comillas, CR o LF", () => {
    expect(noBom([["Pérez, Ana", 'dijo "hola"', "línea 1\nlínea 2", "a\rb", "simple"]])).toBe(
      '"Pérez, Ana","dijo ""hola""","línea 1\nlínea 2","a\rb",simple\r\n',
    );
  });

  it("conserva acentos y caracteres no ASCII", () => {
    expect(noBom([["Córdoba", "ñandú", "¿sí?"]])).toBe("Córdoba,ñandú,¿sí?\r\n");
  });
});

describe("toCsv — tipos de celda", () => {
  it("null y undefined quedan vacíos", () => {
    expect(noBom([[null, undefined, "x"]])).toBe(",,x\r\n");
  });

  it("booleanos como sí/no", () => {
    expect(noBom([[true, false]])).toBe("sí,no\r\n");
  });

  it("fechas en ISO 8601 (UTC)", () => {
    expect(noBom([[new Date("2026-10-15T17:20:00.000Z")]])).toBe("2026-10-15T17:20:00.000Z\r\n");
    expect(noBom([[new Date("no es fecha")]])).toBe("\r\n");
  });

  it("números tal cual, sin protección de fórmula", () => {
    expect(noBom([[0, 3, -5, 2.5]])).toBe("0,3,-5,2.5\r\n");
    expect(noBom([[Number.NaN, Number.POSITIVE_INFINITY]])).toBe(",\r\n");
  });
});

describe("toCsv — inyección de fórmulas", () => {
  it("antepone apóstrofo a =, @, tab y CR", () => {
    expect(noBom([["=SUM(A1:A2)", "@cmd", "\tx", "=1+1"]])).toBe("'=SUM(A1:A2),'@cmd,'\tx,'=1+1\r\n");
    // Con CR además queda entrecomillado.
    expect(noBom([["\rhola"]])).toBe("\"'\rhola\"\r\n");
  });

  it("antepone apóstrofo a + o - seguidos de texto", () => {
    expect(noBom([["+HYPERLINK(\"http://x\")", "-cmd|' /C calc'!A0", "-", "+"]])).toBe(
      '"\'+HYPERLINK(""http://x"")",\'-cmd|\' /C calc\'!A0,\'-,\'+\r\n',
    );
  });

  it("deja intactos teléfonos y números escritos como texto", () => {
    expect(
      noBom([["+5493511234567", "+54 9 351 123-4567", "+54 (351) 1234567", "-12.5", "-3"]]),
    ).toBe("+5493511234567,+54 9 351 123-4567,+54 (351) 1234567,-12.5,-3\r\n");
  });

  it("protege y además entrecomilla cuando hace falta", () => {
    expect(noBom([["=1,2", '@SUM("x")']])).toBe('"\'=1,2","\'@SUM(""x"")"\r\n');
    expect(noBom([["=A1;B1"]], ";")).toBe("\"'=A1;B1\"\r\n");
  });

  it("antepone apóstrofo a + o - con letras aunque haya dígitos", () => {
    expect(noBom([["+1 SUM(A1)", "- cmd", "-2+3", "+54 9 351 abc"]])).toBe(
      "'+1 SUM(A1),'- cmd,'-2+3,'+54 9 351 abc\r\n",
    );
  });

  it("deja intacto el teléfono normalizado también con otro separador", () => {
    expect(noBom([["Ana", "+5493511234567"]], ";")).toBe("Ana;+5493511234567\r\n");
  });

  it("no protege celdas que no son texto", () => {
    expect(noBom([[-1, new Date("2026-10-15T17:20:00.000Z"), false]])).toBe(
      "-1,2026-10-15T17:20:00.000Z,no\r\n",
    );
  });

  it("no toca textos que contienen esos caracteres en el medio", () => {
    expect(noBom([["ana@mail.com", "a=b", "x-y"]])).toBe("ana@mail.com,a=b,x-y\r\n");
  });
});
