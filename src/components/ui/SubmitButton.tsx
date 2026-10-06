"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "./Button";

type Props = Omit<ComponentProps<typeof Button>, "type" | "pending"> & {
  pendingLabel?: ReactNode;
};

/** Botón de submit que se deshabilita mientras el form está enviándose (anti doble tap). */
export function SubmitButton({ children, pendingLabel, ...rest }: Props) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" pending={pending} pendingLabel={pendingLabel} {...rest}>
      {children}
    </Button>
  );
}
