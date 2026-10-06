"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { registerAction } from "@/actions/participant";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { useActionRunner } from "@/components/ui/useActionRunner";

function Check({
  checked,
  onChange,
  children,
  name,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  name: string;
}) {
  return (
    <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border-2 border-line bg-paper p-4 has-[:checked]:border-brand">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-6 shrink-0 accent-brand"
      />
      <span className="text-base leading-snug">{children}</span>
    </label>
  );
}

export function RegisterForm({ eventSlug, late }: { eventSlug: string; late: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [operational, setOperational] = useState(false);
  const [community, setCommunity] = useState(false);
  const { run, pending, error } = useActionRunner();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const res = await run(() =>
      registerAction(eventSlug, {
        name,
        whatsapp,
        operationalConsent: operational,
        communityConsent: community,
      }),
    );
    if (res?.ok) router.push(res.data.next);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Tu nombre" htmlFor="reg-name">
        <TextInput
          id="reg-name"
          name="name"
          autoComplete="given-name"
          required
          minLength={2}
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Tu WhatsApp" htmlFor="reg-wa" hint="Con código de área, por ejemplo 351 123 4567.">
        <TextInput
          id="reg-wa"
          name="whatsapp"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
        />
      </Field>
      <div className="space-y-3">
        <Check name="operational" checked={operational} onChange={setOperational}>
          Acepto recibir mensajes operativos relacionados con este Innovatón.
        </Check>
        <Check name="community" checked={community} onChange={setCommunity}>
          Quiero recibir próximas oportunidades de Espacio IDI. <span className="text-muted">(Opcional)</span>
        </Check>
      </div>
      {late ? (
        <Notice tone="warn">
          La inscripción para el matching ya cerró. Te anotamos igual y el staff del stand te suma si es posible.
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" pending={pending} pendingLabel="Inscribiendo…" disabled={!operational}>
        INSCRIBIRME
      </Button>
      {!operational ? (
        <p className="text-center text-sm text-muted">
          Para participar necesitamos poder escribirte por WhatsApp sobre este Innovatón.
        </p>
      ) : null}
    </form>
  );
}
