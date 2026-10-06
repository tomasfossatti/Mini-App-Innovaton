"use client";

import { Notice } from "./Notice";

/** Error de una acción, con botón para recargar cuando hace falta (red colgada o versión nueva). */
export function ActionError({ error, needsReload }: { error: string | null; needsReload?: boolean }) {
  if (!error) return null;
  return (
    <Notice tone="error">
      <p>{error}</p>
      {needsReload ? (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 min-h-11 rounded-xl bg-danger px-4 font-semibold text-white"
        >
          Recargar la página
        </button>
      ) : null}
    </Notice>
  );
}
