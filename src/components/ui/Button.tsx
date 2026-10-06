import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "accent";
export type ButtonSize = "lg" | "md" | "sm";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white hover:bg-brand-strong active:bg-brand-strong disabled:bg-brand/50",
  accent: "bg-accent text-ink hover:brightness-95 active:brightness-90 disabled:opacity-60",
  secondary:
    "bg-paper text-ink border-2 border-line hover:border-brand active:bg-brand-soft disabled:opacity-60",
  ghost: "bg-transparent text-brand underline-offset-4 hover:underline disabled:opacity-60",
  danger: "bg-danger text-white hover:brightness-95 disabled:opacity-60",
};

const SIZES: Record<ButtonSize, string> = {
  lg: "min-h-14 px-6 text-lg w-full",
  md: "min-h-12 px-5 text-base",
  sm: "min-h-10 px-3 text-sm",
};

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "lg") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-2xl font-semibold tracking-tight transition",
    "disabled:cursor-not-allowed select-none text-center",
    VARIANTS[variant],
    SIZES[size],
  );
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pending?: boolean;
  pendingLabel?: ReactNode;
};

export function Button({
  variant = "primary",
  size = "lg",
  pending = false,
  pendingLabel,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(buttonClasses(variant, size), className)}
      {...rest}
    >
      {pending ? (
        <>
          <Spinner />
          <span>{pendingLabel ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

type LinkButtonProps = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function LinkButton({ variant = "primary", size = "lg", className, ...rest }: LinkButtonProps) {
  return <Link className={cn(buttonClasses(variant, size), className)} {...rest} />;
}
