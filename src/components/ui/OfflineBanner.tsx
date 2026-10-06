"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function OfflineBanner() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-50 bg-warn px-4 py-2 text-center text-sm font-semibold text-white"
    >
      Sin conexión. Cuando vuelva la señal, seguí desde donde estabas.
    </div>
  );
}
