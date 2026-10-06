"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import type { ActionResult } from "@/actions/result";

const NETWORK_ERROR = "No pudimos conectar. Revisá la señal y probá de nuevo.";
const TIMEOUT_ERROR = "Está tardando más de lo normal. Recargá la página y volvé a intentar: no se duplica nada.";
const NEW_VERSION_ERROR = "Hay una versión nueva de la app. Recargá la página para seguir.";
const TIMEOUT_MS = 20_000;

class ActionTimeout extends Error {}

/**
 * Ejecuta una Server Action desde un handler de cliente:
 * - una sola ejecución a la vez (doble tap no duplica);
 * - expone pending y error para la UI;
 * - con red colgada corta a los 20 s y ofrece recargar (las acciones son idempotentes);
 * - después de un deploy, pide recargar en lugar de fallar en loop.
 */
export function useActionRunner() {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);

  const run = useCallback(
    async <T,>(action: () => Promise<ActionResult<T>>): Promise<ActionResult<T> | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setPending(true);
      setError(null);
      setNeedsReload(false);
      let timer: number | undefined;
      try {
        const result = await Promise.race([
          action(),
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(() => reject(new ActionTimeout()), TIMEOUT_MS);
          }),
        ]);
        if (!result.ok) setError(result.error);
        return result;
      } catch (err) {
        // redirect()/notFound() dentro de una action llegan como excepción especial: re-lanzarlas.
        if (err && typeof err === "object" && "digest" in err) throw err;
        const message =
          err instanceof ActionTimeout
            ? TIMEOUT_ERROR
            : unstable_isUnrecognizedActionError(err)
              ? NEW_VERSION_ERROR
              : NETWORK_ERROR;
        setError(message);
        setNeedsReload(message !== NETWORK_ERROR);
        return { ok: false, error: message };
      } finally {
        window.clearTimeout(timer);
        inFlight.current = false;
        setPending(false);
      }
    },
    [],
  );

  return { run, pending, error, setError, needsReload };
}
