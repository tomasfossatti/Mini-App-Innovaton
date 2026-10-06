"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { recoverAction } from "@/actions/participant";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { ActionError } from "@/components/ui/ActionError";
import { useActionRunner } from "@/components/ui/useActionRunner";

export function RecoverForm({ eventSlug }: { eventSlug: string }) {
  const router = useRouter();
  const [whatsapp, setWhatsapp] = useState("");
  const [code, setCode] = useState("");
  const { run, pending, error, needsReload } = useActionRunner();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const res = await run(() => recoverAction(eventSlug, whatsapp, code));
    if (res?.ok) router.push(res.data.next);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="El WhatsApp con el que te inscribiste" htmlFor="rec-wa">
        <TextInput
          id="rec-wa"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
        />
      </Field>
      <Field label="Código que te dieron en el stand" htmlFor="rec-code">
        <TextInput
          id="rec-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={12}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </Field>
      <ActionError error={error} needsReload={needsReload} />
      {error && needsReload ? (
        <p className="text-sm text-muted">
          Cada código sirve una sola vez. Si después de recargar no entraste, pedí uno nuevo en el stand.
        </p>
      ) : null}
      <Button type="submit" pending={pending} pendingLabel="Buscando…">
        RECUPERAR MI LUGAR
      </Button>
    </form>
  );
}
