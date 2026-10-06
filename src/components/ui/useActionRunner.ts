"use client";

import { useCallback, useRef, useState } from "react";
import type { ActionResult } from "@/actions/result";

const NETWORK_ERROR = "No pudimos conectar. Revisá la señal y probá de nuevo.";

/**
 * Ejecuta una Server Action desde un handler de cliente:
 * - una sola ejecución a la vez (doble tap no duplica);
 * - expone pending y error para la UI;
 * - convierte fallas de red en un mensaje claro.
 */
export function useActionRunner() {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(action: () => Promise<ActionResult<T>>): Promise<ActionResult<T> | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setPending(true);
      setError(null);
      try {
        const result = await action();
        if (!result.ok) setError(result.error);
        return result;
      } catch (err) {
        // redirect() dentro de una action llega como excepción especial: re-lanzarla.
        if (err && typeof err === "object" && "digest" in err) throw err;
        setError(NETWORK_ERROR);
        return { ok: false, error: NETWORK_ERROR };
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [],
  );

  return { run, pending, error, setError };
}
