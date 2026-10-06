export function Progress({ current, total, label }: { current: number; total: number; label?: string }) {
  return (
    <div aria-label={`Paso ${current} de ${total}`}>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i < current ? "bg-brand" : "bg-line"}`} />
        ))}
      </div>
      <p className="mt-1.5 text-sm font-semibold text-muted">{label ?? `${current}/${total}`}</p>
    </div>
  );
}
