"use client";

import { useEffect } from "react";
import { Button } from "./Button";

/**
 * Pantalla de error con reintento (red inestable en la feria). `retry` vuelve a pedir la página
 * al servidor; si no alcanza, se ofrece recargar.
 */
export function ErrorState({
  error,
  retry,
  homeHref,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  homeHref?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex min-h-[60dvh] w-full max-w-md flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-2xl font-bold">Algo no cargó bien</h1>
      <p className="text-muted">Puede ser la conexión. Probá de nuevo; tus respuestas ya guardadas no se pierden.</p>
      <Button onClick={() => retry()}>Reintentar</Button>
      <Button variant="secondary" onClick={() => window.location.reload()}>
        Recargar la página
      </Button>
      {homeHref ? (
        <a href={homeHref} className="min-h-11 content-center text-center font-semibold text-brand underline underline-offset-4">
          Volver al inicio
        </a>
      ) : null}
    </div>
  );
}
