import type { ComponentProps } from "react";
import { cn } from "./cn";

export function Card({ className, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-3xl border border-line bg-paper p-5 shadow-sm", className)}
      {...rest}
    />
  );
}
