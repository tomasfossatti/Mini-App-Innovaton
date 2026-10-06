import { parsePhoneNumberFromString, type CountryCode, type PhoneNumber } from "libphonenumber-js";

// Normalización de WhatsApp (PRD §11, 02 §9 registerParticipant).
// Se usa la metadata "min" (import por defecto): valida largo y prefijos por país.
// La metadata "max" valida rangos exactos y rechaza números posibles como +54 9 351 123 4567,
// lo que en el stand se traduce en personas que no pueden inscribirse.

export type PhoneResult =
  | { ok: true; e164: string; display: string; waNumber: string }
  | { ok: false; error: string };

export const WHATSAPP_ERROR = "Revisá el número de WhatsApp (incluí el código de área).";

const AR_CALLING_CODE = "54";
// Áreas geográficas argentinas: 11 (AMBA) o empiezan con 2 o 3. No existe un área "15" ni "10":
// "+54 9 15 1234 5678" es un celular de AMBA al que le falta el 11. 0800, 0810 y 0600 tampoco
// pueden ser WhatsApp. La metadata "min" no distingue estos casos, por eso se filtran acá.
const AR_GEOGRAPHIC = /^(?:11|[23])/;

function fail(): PhoneResult {
  return { ok: false, error: WHATSAPP_ERROR };
}

/**
 * Normaliza un número de WhatsApp a E.164. Los números argentinos se llevan siempre al
 * formato móvil que usa WhatsApp: +54 9 + código de área + número (10 dígitos), aunque la
 * persona lo escriba sin el 9, sin el 15, con 0 de larga distancia o con separadores.
 */
export function normalizeWhatsapp(input: string, defaultCountry: CountryCode = "AR"): PhoneResult {
  // Tabs, saltos de línea o espacios finos (copiar y pegar) se tratan como un espacio común.
  const raw = input.replace(/\s+/g, " ").trim();
  if (raw === "") return fail();

  const parsed = parse(raw, defaultCountry);
  // Un interno no tiene sentido en WhatsApp: se rechaza en vez de descartarlo en silencio.
  if (!parsed || !parsed.isValid() || parsed.ext) return fail();

  let phone: PhoneNumber = parsed;
  if (parsed.countryCallingCode === AR_CALLING_CODE) {
    const national: string = parsed.nationalNumber;
    if (national.length === 10 && AR_GEOGRAPHIC.test(national)) {
      // Sin el 9 la librería lo interpreta como fijo; WhatsApp lo registra como móvil.
      const mobile = parsePhoneNumberFromString(`+${AR_CALLING_CODE}9${national}`);
      if (!mobile || !mobile.isValid()) return fail();
      phone = mobile;
    } else {
      const isMobile =
        national.length === 11 && national.startsWith("9") && AR_GEOGRAPHIC.test(national.slice(1));
      if (!isMobile) return fail();
    }
  }

  const e164: string = phone.number;
  return {
    ok: true,
    e164,
    display: phone.formatInternational(),
    waNumber: e164.slice(1),
  };
}

function parse(raw: string, defaultCountry: CountryCode): PhoneNumber | undefined {
  const parsed = parsePhoneNumberFromString(raw, defaultCountry);
  if (
    parsed &&
    !parsed.isValid() &&
    !parsed.ext &&
    parsed.countryCallingCode === AR_CALLING_CODE &&
    parsed.nationalNumber.startsWith("9")
  ) {
    // "+54 9 351 15 123 4567" (con el 9 y el 15 a la vez): sin el 9, la librería quita el 15.
    const retry = parsePhoneNumberFromString(`+${AR_CALLING_CODE}${parsed.nationalNumber.slice(1)}`);
    if (retry && retry.isValid()) return retry;
  }
  return parsed;
}

/** Link para abrir un chat de WhatsApp, opcionalmente con un mensaje precargado. */
export function waLink(waNumber: string, text?: string): string {
  // wa.me espera solo dígitos (sin "+", espacios ni guiones).
  const digits = waNumber.replace(/\D/g, "");
  const base = `https://wa.me/${digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
