"use client";

import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";

/**
 * Refresca la pantalla del staff cada N segundos (dos o más personas operando a la vez).
 * Antes de refrescar verifica que haya conexión: si el refresco falla sin red, Next recarga la
 * página entera y el staff perdería lo que estaba viendo justo cuando más lo necesita.
 */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  const [offline, setOffline] = useState(false);
  const running = useRef(false);

  const tick = useCallback(
    async (force = false) => {
      if (running.current || document.visibilityState !== "visible") return;
      const active = document.activeElement;
      // No refrescar mientras alguien escribe o elige en un formulario.
      if (!force && active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;
      if (!navigator.onLine) {
        setOffline(true);
        return;
      }
      running.current = true;
      try {
        const res = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error(String(res.status));
        setOffline(false);
        startTransition(() => router.refresh());
        setUpdatedAt(new Date());
      } catch {
        setOffline(true);
      } finally {
        running.current = false;
      }
    },
    [router],
  );

  useEffect(() => {
    const timer = window.setInterval(() => void tick(), seconds * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [tick, seconds]);

  const time = updatedAt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return offline ? (
    <p className="no-print rounded-xl bg-warn-soft px-3 py-2 text-sm font-semibold text-warn" role="status" suppressHydrationWarning>
      Sin conexión · datos de las {time}. Se actualiza solo cuando vuelva la señal.
    </p>
  ) : (
    <p className="no-print text-xs text-muted" suppressHydrationWarning>
      Se actualiza cada {seconds} s · última {time}
    </p>
  );
}
