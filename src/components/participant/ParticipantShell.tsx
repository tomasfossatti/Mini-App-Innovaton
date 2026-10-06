import type { ReactNode } from "react";
import { OfflineBanner } from "@/components/ui/OfflineBanner";

/** Contenedor mobile-first de las pantallas del participante. */
export function ParticipantShell({
  children,
  footer,
  eventName,
  progress,
}: {
  children: ReactNode;
  footer?: ReactNode;
  eventName?: string;
  progress?: { current: number; total: number };
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <OfflineBanner />
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 pt-4 text-sm font-semibold text-muted">
        <span>{eventName ?? "Innovatón"}</span>
        <span className="text-xs font-medium">Espacio IDI + Educai</span>
      </header>
      {progress ? (
        <div className="mx-auto w-full max-w-md px-4 pt-3" aria-label={`Paso ${progress.current} de ${progress.total}`}>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: progress.total }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-full ${i < progress.current ? "bg-brand" : "bg-line"}`}
              />
            ))}
          </div>
          <p className="mt-1.5 text-sm font-semibold text-muted">
            {progress.current}/{progress.total}
          </p>
        </div>
      ) : null}
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-6 pt-4">{children}</main>
      {footer ? (
        <div className="sticky bottom-0 border-t border-line bg-canvas/95 backdrop-blur">
          <div className="mx-auto w-full max-w-md px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        </div>
      ) : null}
    </div>
  );
}
