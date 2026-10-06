// Exportación CSV para el staff (RFC 4180), lista para abrir en Excel o Google Sheets.

export type CsvCell = string | number | boolean | null | undefined | Date;

export interface CsvOptions {
  /** BOM UTF-8 al inicio para que Excel detecte los acentos. Default: true. */
  bom?: boolean;
  /** Default: ",". */
  separator?: string;
}

const CRLF = "\r\n";
const BOM = "\uFEFF";

// Números y teléfonos ("+5493511234567", "-12.5", "+54 (351) 123-4567") empiezan con + o -
// pero no pueden ejecutar nada en una planilla: se dejan intactos.
const NUMERIC_LIKE = /^[+-][\d\s().-]+$/;

/** Genera un CSV donde cada fila termina en CRLF. */
export function toCsv(rows: CsvCell[][], options: CsvOptions = {}): string {
  const separator = options.separator ?? ",";
  if (separator === "" || /["\r\n]/.test(separator)) {
    throw new Error("Separador de CSV inválido.");
  }
  const body = rows
    .map((row) => row.map((cell) => escapeField(cellToText(cell), separator)).join(separator) + CRLF)
    .join("");
  const withBom = options.bom ?? true;
  return (withBom ? BOM : "") + body;
}

function cellToText(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "boolean") return cell ? "sí" : "no";
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? "" : cell.toISOString();
  return protectFormula(cell);
}

/**
 * Evita la inyección de fórmulas (CSV injection): si el texto empieza con un carácter que la
 * planilla interpretaría como fórmula, se antepone un apóstrofo.
 */
function protectFormula(text: string): string {
  const first = text.charAt(0);
  if (first === "=" || first === "@" || first === "\t" || first === "\r") return `'${text}`;
  if ((first === "+" || first === "-") && !NUMERIC_LIKE.test(text)) return `'${text}`;
  return text;
}

/** RFC 4180: comillas si el campo contiene separador, comillas, CR o LF; las comillas se duplican. */
function escapeField(text: string, separator: string): string {
  const needsQuotes =
    text.includes(separator) || text.includes('"') || text.includes("\r") || text.includes("\n");
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}
