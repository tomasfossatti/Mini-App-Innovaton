"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Refresca la pantalla del staff cada N segundos (dos o más personas operando a la vez). */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const active = document.activeElement;
      // No refrescar mientras alguien escribe en un formulario.
      if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;
      router.refresh();
      setUpdatedAt(new Date());
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [router, seconds]);
  return (
    <p className="no-print text-xs text-muted" suppressHydrationWarning>
      Se actualiza cada {seconds} s · última {updatedAt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </p>
  );
}
