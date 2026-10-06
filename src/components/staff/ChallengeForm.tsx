"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ActionResult } from "@/actions/result";
import { Field, TextArea, TextInput } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { SubmitButton } from "@/components/ui/SubmitButton";

export interface ChallengeFormValues {
  startupName: string;
  title: string;
  description: string;
  brief: string;
  prize: string;
  sortOrder: number;
  active: boolean;
}

export function ChallengeForm({
  action,
  values,
  submitLabel,
  idPrefix,
  resetOnSuccess = false,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  values: ChallengeFormValues;
  submitLabel: string;
  idPrefix: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state?.ok) formRef.current?.reset();
  }, [resetOnSuccess, state]);
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field label="Startup" htmlFor={id("startup")}>
          <TextInput id={id("startup")} name="startupName" defaultValue={values.startupName} required />
        </Field>
        <Field label="Orden" htmlFor={id("order")}>
          <TextInput id={id("order")} name="sortOrder" type="number" min={0} max={999} defaultValue={values.sortOrder} required />
        </Field>
      </div>
      <Field label="Descripción breve de la startup" htmlFor={id("desc")}>
        <TextInput id={id("desc")} name="description" defaultValue={values.description} required />
      </Field>
      <Field
        label="Desafío"
        htmlFor={id("title")}
        hint="Formato sugerido: ¿Cómo podríamos ___ para que ___ sin ___?"
      >
        <TextArea id={id("title")} name="title" defaultValue={values.title} required className="min-h-20" />
      </Field>
      <Field label="Brief completo (para staff, facilitadores e impresión)" htmlFor={id("brief")}>
        <TextArea id={id("brief")} name="brief" defaultValue={values.brief} className="min-h-40 text-base" />
      </Field>
      <Field label="Premio / beneficio (opcional)" htmlFor={id("prize")}>
        <TextInput id={id("prize")} name="prize" defaultValue={values.prize} />
      </Field>
      <label className="flex min-h-11 items-center gap-3 text-base font-medium">
        <input type="checkbox" name="active" defaultChecked={values.active} className="size-5 accent-brand" />
        Activo (visible para participantes)
      </label>
      {state && !state.ok ? <Notice tone="error">{state.error}</Notice> : null}
      {state && state.ok ? <Notice tone="success">Guardado.</Notice> : null}
      <SubmitButton size="md" pendingLabel="Guardando…">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
