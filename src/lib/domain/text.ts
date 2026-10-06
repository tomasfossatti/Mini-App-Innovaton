/** Une una lista en español: "a", "a y b", "a, b y c". */
export function joinEs(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function normalizeName(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * ¿Dos nombres parecen de la misma persona? Coinciden en la primera palabra (sin tildes ni
 * mayúsculas), p. ej. "María" y "maria pérez". Se usa para no pisar a otra persona cuando el
 * staff carga un WhatsApp mal tipeado.
 */
export function namesLikelyMatch(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (x.length === 0 || y.length === 0) return false;
  return x[0] === y[0];
}
