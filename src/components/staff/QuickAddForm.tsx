"use client";

import { useState, type FormEvent } from "react";
import { quickAddAction } from "@/actions/staff";
import { MODES, type Mode } from "@/lib/domain/constants";
import { MODE_LABELS, MODE_SHORT } from "@/lib/domain/copy";
import { Button } from "@/components/ui/Button";
import { Field, Select, TextInput } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { useActionRunner } from "@/components/ui/useActionRunner";

const ANY = "ANY";

export function QuickAddForm({
  eventId,
  challenges,
}: {
  eventId: string;
  challenges: { id: string; startupName: string }[];
}) {
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState(ANY);
  const [mode, setMode] = useState<Mode | "">("");
  const [done, setDone] = useState<string | null>(null);
  const { run, pending, error } = useActionRunner();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone(null);
    const res = await run(() =>
      quickAddAction(eventId, {
        name,
        whatsapp,
        firstChoiceId: first,
        secondChoiceId: second === ANY ? null : second,
        secondChoiceAny: second === ANY,
        initialMode: mode || null,
      }),
    );
    if (res?.ok) {
      setDone(res.data.created ? `${name} quedó presente.` : `${name} ya estaba inscripta/o: quedó presente.`);
      setName("");
      setWhatsapp("");
      setFirst("");
      setSecond(ANY);
      setMode("");
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <Field label="Nombre" htmlFor="qa-name">
        <TextInput id="qa-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="WhatsApp" htmlFor="qa-wa">
        <TextInput id="qa-wa" type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} required />
      </Field>
      <Field label="Desafío 1" htmlFor="qa-first">
        <Select
          id="qa-first"
          value={first}
          onChange={(e) => {
            setFirst(e.target.value);
            // Si la 2ª quedaba igual a la nueva 1ª, se vuelve a "Cualquiera" (lo que se ve en pantalla).
            if (second === e.target.value) setSecond(ANY);
          }}
          required
        >
          <option value="">Elegí…</option>
          {challenges.map((c) => (
            <option key={c.id} value={c.id}>
              {c.startupName}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Desafío 2" htmlFor="qa-second">
        <Select id="qa-second" value={second} onChange={(e) => setSecond(e.target.value)}>
          <option value={ANY}>Cualquiera</option>
          {challenges
            .filter((c) => c.id !== first)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.startupName}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Modo del cuestionario en papel (opcional)" htmlFor="qa-mode">
        <Select id="qa-mode" value={mode} onChange={(e) => setMode(e.target.value as Mode | "")}>
          <option value="">Sin cuestionario</option>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_SHORT[m]} · {MODE_LABELS[m]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="space-y-3 sm:col-span-2">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {done ? <Notice tone="success">{done}</Notice> : null}
        <Button type="submit" size="md" pending={pending} pendingLabel="Guardando…">
          Agregar como presente
        </Button>
      </div>
    </form>
  );
}
