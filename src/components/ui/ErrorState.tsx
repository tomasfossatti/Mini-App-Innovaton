"use client";

import { useEffect } from "react";
import { Button } from "./Button";

/** Pantalla de error con reintento (red inestable en la feria). */
export function ErrorState({ error, reset, homeHref }: { error: Error & { digest?: string }; reset: () => void; homeHref?: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex min-h-[60dvh] w-full max-w-md flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-2xl font-bold">Algo no cargó bien</h1>
      <p className="text-muted">Puede ser la conexión. Probá de nuevo; tus respuestas ya guardadas no se pierden.</p>
      <Button onClick={() => reset()}>Reintentar</Button>
      {homeHref ? (
        <a href={homeHref} className="min-h-11 content-center text-center font-semibold text-brand underline underline-offset-4">
          Volver al inicio
        </a>
      ) : null}
    </div>
  );
}
