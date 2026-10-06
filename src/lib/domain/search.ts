import type { CountryCode } from "libphonenumber-js";
import { normalizeWhatsapp } from "./phone";

/**
 * ¿El teléfono guardado coincide con lo que tipeó el staff? Acepta los formatos habituales
 * ("0351 15 123-4567", "351 15 1234567", "+54 9 …") normalizándolos igual que la inscripción.
 * Con teléfonos enmascarados (cuentas STAFF) solo se comparan los últimos 4 dígitos.
 */
export function phoneMatches(
  stored: string,
  query: string,
  opts: { masked?: boolean; country?: CountryCode } = {},
): boolean {
  const typed = query.replace(/\D/g, "");
  if (typed.length < 3) return false;
  const candidates = [typed];
  if (typed.length >= 6) {
    const parsed = normalizeWhatsapp(query, opts.country ?? "AR");
    if (parsed.ok) candidates.push(parsed.e164.replace(/\D/g, ""));
  }
  const storedDigits = stored.replace(/\D/g, "");
  if (opts.masked) {
    const visible = storedDigits.slice(-4);
    return candidates.some((c) => (c.length >= 4 ? c.slice(-4) === visible : visible.includes(c)));
  }
  return candidates.some((c) => storedDigits.includes(c));
}
