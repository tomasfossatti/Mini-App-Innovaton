import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { isDomainError } from "@/lib/services/errors";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

export const GENERIC_ERROR = "Algo falló. Probá de nuevo en unos segundos.";

/**
 * Ejecuta la lógica de una Server Action y normaliza errores.
 * - DomainError → mensaje para la persona usuaria.
 * - ZodError → "Revisá los datos".
 * - redirect()/notFound() de Next se re-lanzan para que funcionen.
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    unstable_rethrow(err);
    if (isDomainError(err)) return { ok: false, error: err.message };
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return { ok: false, error: first?.message && !first.message.startsWith("Invalid") ? first.message : "Revisá los datos ingresados." };
    }
    console.error("[action] error inesperado", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}
