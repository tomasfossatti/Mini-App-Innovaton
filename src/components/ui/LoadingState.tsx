import { Spinner } from "./Spinner";

export function LoadingState({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="flex min-h-[50dvh] items-center justify-center gap-3 text-muted" role="status">
      <Spinner className="text-brand" />
      <span className="font-medium">{label}</span>
    </div>
  );
}
