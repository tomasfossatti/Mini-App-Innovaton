import type { ReactNode } from "react";
import { cn } from "./cn";

const TONES = {
  info: "bg-brand-soft text-brand-strong border-brand/20",
  success: "bg-ok-soft text-ok border-ok/20",
  warn: "bg-warn-soft text-warn border-warn/20",
  error: "bg-danger-soft text-danger border-danger/20",
} as const;

export function Notice({
  tone = "info",
  title,
  children,
  className,
  role,
}: {
  tone?: keyof typeof TONES;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  return (
    <div
      role={role ?? (tone === "error" ? "alert" : "status")}
      className={cn("rounded-2xl border px-4 py-3 text-base", TONES[tone], className)}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cn(title ? "mt-1" : "")}>{children}</div> : null}
    </div>
  );
}
