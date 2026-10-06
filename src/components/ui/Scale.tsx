"use client";

import { cn } from "./cn";

/** Escala 1–5 con botones grandes (una decisión por pantalla). */
export function Scale({
  value,
  onChange,
  minLabel,
  maxLabel,
  disabled,
  name,
}: {
  value: number | null;
  onChange: (value: number) => void;
  minLabel: string;
  maxLabel: string;
  disabled?: boolean;
  name: string;
}) {
  return (
    <div>
      <div role="radiogroup" aria-label={name} className="grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((n) => {
          const selected = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${n}${n === 1 ? ` (${minLabel})` : n === 5 ? ` (${maxLabel})` : ""}`}
              disabled={disabled}
              onClick={() => onChange(n)}
              className={cn(
                "min-h-16 rounded-2xl border-2 text-2xl font-bold transition",
                selected
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-paper text-ink active:bg-brand-soft",
                disabled && "opacity-60",
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-sm text-muted">
        <span>1 · {minLabel}</span>
        <span>{maxLabel} · 5</span>
      </div>
    </div>
  );
}
