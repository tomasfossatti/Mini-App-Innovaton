"use client";

import { useState } from "react";
import { submitReflectionByStaffAction } from "@/actions/founder";
import { MODES, REFLECTION_ACTIONS, type Capability, type Mode, type ReflectionAction } from "@/lib/domain/constants";
import { MODE_LABELS, MODE_SHORT, PRIMARY_CONTRIBUTION_OPTIONS, REFLECTION_ACTION_LABELS } from "@/lib/domain/copy";
import { Button } from "@/components/ui/Button";
import { Select, TextInput } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { cn } from "@/components/ui/cn";
import { useActionRunner } from "@/components/ui/useActionRunner";

function MiniScale({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number) => void }) {
  return (
    <div>
      <p className="text-sm font-semibold">{label}</p>
      <div className="mt-1 grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            onClick={() => onChange(n)}
            className={cn(
              "min-h-11 rounded-xl border-2 font-bold",
              value === n ? "border-brand bg-brand text-white" : "border-line bg-paper",
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Carga de la reflexión hecha en papel (03 §13) o de alguien sin celular. */
export function StaffReflectionForm({
  eventId,
  participationId,
  name,
  initialMode,
}: {
  eventId: string;
  participationId: string;
  name: string;
  /** Si es null (alta del staff sin cuestionario), se puede cargar el modo del cuestionario en papel. */
  initialMode: Mode | null;
}) {
  const [postClarity, setPostClarity] = useState<number | null>(null);
  const [actions, setActions] = useState<ReflectionAction[]>([]);
  const [capability, setCapability] = useState<Capability | "">("");
  const [text, setText] = useState("");
  const [perceivedValue, setPerceivedValue] = useState<number | null>(null);
  const [usefulness, setUsefulness] = useState<number | null>(null);
  const [paperMode, setPaperMode] = useState<Mode | "">("");
  const [done, setDone] = useState(false);
  const { run, pending, error } = useActionRunner();

  const ready = postClarity && actions.length > 0 && capability && perceivedValue && usefulness;
  if (done) return <Notice tone="success">Reflexión de {name} cargada.</Notice>;

  return (
    <div className="space-y-3 rounded-2xl border border-line p-3">
      {initialMode === null ? (
        <Select
          aria-label="Modo del cuestionario en papel (opcional)"
          value={paperMode}
          onChange={(e) => setPaperMode(e.target.value as Mode | "")}
        >
          <option value="">Modo del cuestionario en papel: sin cuestionario</option>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_SHORT[m]} · {MODE_LABELS[m]}
            </option>
          ))}
        </Select>
      ) : null}
      <MiniScale label="1. Claridad sobre cómo aportó (1 nada claro · 5 muy claro)" value={postClarity} onChange={setPostClarity} />
      <div>
        <p className="text-sm font-semibold">2. Qué hizo (marcá las que figuran en la hoja)</p>
        <div className="mt-1 grid gap-1 sm:grid-cols-2">
          {REFLECTION_ACTIONS.map((a) => (
            <label key={a} className="flex min-h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-brand"
                checked={actions.includes(a)}
                onChange={(e) => setActions(e.target.checked ? [...actions, a] : actions.filter((x) => x !== a))}
              />
              {REFLECTION_ACTION_LABELS[a]}
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select aria-label="3. Aporte más importante" value={capability} onChange={(e) => setCapability(e.target.value as Capability)}>
          <option value="">3. Aporte más importante…</option>
          {PRIMARY_CONTRIBUTION_OPTIONS.map((o) => (
            <option key={o.capability} value={o.capability}>
              {o.label}
            </option>
          ))}
        </Select>
        <TextInput
          aria-label="Texto del aporte (opcional)"
          placeholder="Texto del aporte (opcional)"
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="py-2 text-base"
        />
      </div>
      <MiniScale label="4. ¿Su aporte ayudó al equipo? (1 nada · 5 mucho)" value={perceivedValue} onChange={setPerceivedValue} />
      <MiniScale label="5. ¿La sugerencia inicial le ayudó a participar? (1 nada · 5 mucho)" value={usefulness} onChange={setUsefulness} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button
        size="md"
        disabled={!ready}
        pending={pending}
        pendingLabel="Guardando…"
        onClick={async () => {
          if (!ready) return;
          const res = await run(() =>
            submitReflectionByStaffAction(eventId, participationId, {
              postClarity: postClarity!,
              selectedActions: actions,
              primaryContributionText: text.trim() || null,
              primaryCapability: capability as Capability,
              perceivedValue: perceivedValue!,
              initialModeUsefulness: usefulness!,
            }, paperMode || null),
          );
          if (res?.ok) setDone(true);
        }}
      >
        Guardar reflexión de {name}
      </Button>
    </div>
  );
}
