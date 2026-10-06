"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/actions/result";
import { Field, TextInput } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { SubmitButton } from "@/components/ui/SubmitButton";

export interface EventFormValues {
  name: string;
  slug: string;
  date: string;
  timezone: string;
  locationLabel: string;
  registrationOpens: string;
  checkinOpens: string;
  registrationCloses: string;
  starts: string;
  ends: string;
  communityUrl: string;
}

export const DEFAULT_EVENT_VALUES: EventFormValues = {
  name: "Innovatón",
  slug: "",
  date: "",
  timezone: "America/Argentina/Cordoba",
  locationLabel: "Stand Espacio IDI",
  registrationOpens: "10:00",
  checkinOpens: "14:20",
  registrationCloses: "14:25",
  starts: "14:30",
  ends: "15:35",
  communityUrl: "",
};

export function EventForm<T>({
  action,
  values,
  submitLabel,
}: {
  action: (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;
  values: EventFormValues;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" htmlFor="ev-name">
          <TextInput id="ev-name" name="name" defaultValue={values.name} required />
        </Field>
        <Field label="Identificador (URL)" htmlFor="ev-slug" hint="Queda como /e/identificador. Minúsculas y guiones.">
          <TextInput id="ev-slug" name="slug" defaultValue={values.slug} required pattern="[a-z0-9-]+" />
        </Field>
        <Field label="Fecha" htmlFor="ev-date">
          <TextInput id="ev-date" name="date" type="date" defaultValue={values.date} required />
        </Field>
        <Field label="Zona horaria" htmlFor="ev-tz">
          <TextInput id="ev-tz" name="timezone" defaultValue={values.timezone} required />
        </Field>
        <Field label="Lugar" htmlFor="ev-loc">
          <TextInput id="ev-loc" name="locationLabel" defaultValue={values.locationLabel} required />
        </Field>
        <Field label="Link de comunidad Espacio IDI (opcional)" htmlFor="ev-community" hint="Se muestra después del CTA final.">
          <TextInput id="ev-community" name="communityUrl" type="url" defaultValue={values.communityUrl} placeholder="https://" />
        </Field>
      </div>
      <fieldset className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <legend className="mb-2 text-base font-semibold">Horarios (hora local)</legend>
        <Field label="Abre inscripción" htmlFor="ev-ro">
          <TextInput id="ev-ro" name="registrationOpens" type="time" defaultValue={values.registrationOpens} required />
        </Field>
        <Field label="Abre check-in" htmlFor="ev-ci">
          <TextInput id="ev-ci" name="checkinOpens" type="time" defaultValue={values.checkinOpens} required />
        </Field>
        <Field label="Cierra inscripción" htmlFor="ev-rc">
          <TextInput id="ev-rc" name="registrationCloses" type="time" defaultValue={values.registrationCloses} required />
        </Field>
        <Field label="Empieza" htmlFor="ev-st">
          <TextInput id="ev-st" name="starts" type="time" defaultValue={values.starts} required />
        </Field>
        <Field label="Termina" htmlFor="ev-en">
          <TextInput id="ev-en" name="ends" type="time" defaultValue={values.ends} required />
        </Field>
      </fieldset>
      {state && !state.ok ? <Notice tone="error">{state.error}</Notice> : null}
      {state && state.ok ? <Notice tone="success">Guardado.</Notice> : null}
      <SubmitButton size="md" pendingLabel="Guardando…">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
