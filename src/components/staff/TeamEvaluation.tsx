"use client";

import { useState } from "react";
import {
  addObservationAction,
  deleteArtifactAction,
  deleteObservationAction,
  saveA3BlocksAction,
  saveAssessmentAction,
} from "@/actions/founder";
import { A3_BLOCKS, CAPABILITIES, type A3Block, type Capability, type ObserverSource } from "@/lib/domain/constants";
import { A3_BLOCK_LABELS, CAPABILITY_LABELS } from "@/lib/domain/copy";
import { Button } from "@/components/ui/Button";
import { Field, Select, TextArea } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { cn } from "@/components/ui/cn";
import { useActionRunner } from "@/components/ui/useActionRunner";

function ScoreRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div>
      <p className="font-semibold">
        {label} <span className="font-normal text-muted">· {hint}</span>
      </p>
      <div className="mt-1 grid grid-cols-6 gap-2" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            onClick={() => onChange(n)}
            className={cn(
              "min-h-12 rounded-xl border-2 text-lg font-bold",
              value === n ? "border-brand bg-brand text-white" : "border-line bg-paper",
            )}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn("min-h-12 rounded-xl border-2 text-xs font-semibold", value === null ? "border-ink" : "border-line")}
        >
          Sin nota
        </button>
      </div>
    </div>
  );
}

export function AssessmentForm({
  eventId,
  teamId,
  initial,
}: {
  eventId: string;
  teamId: string;
  initial: { problemScore: number | null; valueScore: number | null; testScore: number | null; feedback: string | null; winner: boolean } | null;
}) {
  const [problem, setProblem] = useState(initial?.problemScore ?? null);
  const [value, setValue] = useState(initial?.valueScore ?? null);
  const [test, setTest] = useState(initial?.testScore ?? null);
  const [feedback, setFeedback] = useState(initial?.feedback ?? "");
  const [winner, setWinner] = useState(initial?.winner ?? false);
  const [saved, setSaved] = useState(false);
  const { run, pending, error } = useActionRunner();

  return (
    <div className="space-y-4">
      <ScoreRow label="Problema" hint="¿entendieron el problema real?" value={problem} onChange={setProblem} />
      <ScoreRow label="Valor" hint="¿la propuesta genera valor?" value={value} onChange={setValue} />
      <ScoreRow label="Prueba" hint="¿la primera prueba es concreta?" value={test} onChange={setTest} />
      <Field label="Feedback para el equipo (opcional)" htmlFor={`fb-${teamId}`}>
        <TextArea id={`fb-${teamId}`} value={feedback} maxLength={1000} onChange={(e) => setFeedback(e.target.value)} />
      </Field>
      <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 border-line bg-paper px-4 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
        <input type="checkbox" className="size-6 accent-brand" checked={winner} onChange={(e) => setWinner(e.target.checked)} />
        <span className="font-semibold">Ganador / reconocimiento del founder</span>
      </label>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {saved && !pending ? <Notice tone="success">Evaluación guardada.</Notice> : null}
      <Button
        size="md"
        pending={pending}
        pendingLabel="Guardando…"
        onClick={async () => {
          setSaved(false);
          const res = await run(() =>
            saveAssessmentAction(eventId, teamId, {
              problemScore: problem,
              valueScore: value,
              testScore: test,
              feedback: feedback.trim() || null,
              winner,
            }),
          );
          if (res?.ok) setSaved(true);
        }}
      >
        Guardar evaluación
      </Button>
    </div>
  );
}

export function A3BlocksForm({ eventId, teamId, initial }: { eventId: string; teamId: string; initial: A3Block[] }) {
  const [blocks, setBlocks] = useState<A3Block[]>(initial);
  const [saved, setSaved] = useState(false);
  const { run, pending, error } = useActionRunner();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Marcá los bloques que quedaron completos en el A3 (lo decide una persona, no hay análisis automático).</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {A3_BLOCKS.map((b) => (
          <label key={b} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border-2 border-line bg-paper px-3 has-[:checked]:border-brand">
            <input
              type="checkbox"
              className="size-5 accent-brand"
              checked={blocks.includes(b)}
              onChange={(e) => {
                setSaved(false);
                setBlocks(e.target.checked ? [...blocks, b] : blocks.filter((x) => x !== b));
              }}
            />
            <span>
              <span className="font-semibold">{A3_BLOCK_LABELS[b].title}</span>
              <span className="block text-xs text-muted">{A3_BLOCK_LABELS[b].question}</span>
            </span>
          </label>
        ))}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          pending={pending}
          onClick={async () => {
            const res = await run(() => saveA3BlocksAction(eventId, teamId, blocks));
            if (res?.ok) setSaved(true);
          }}
        >
          Guardar bloques
        </Button>
        {saved ? <span className="text-sm font-semibold text-ok">Guardado.</span> : null}
      </div>
    </div>
  );
}

export function DeleteArtifactButton({ eventId, artifactId }: { eventId: string; artifactId: string }) {
  const { run, pending, error } = useActionRunner();
  return (
    <div>
      <Button
        size="sm"
        variant="ghost"
        pending={pending}
        onClick={() => {
          if (confirm("¿Borrar esta foto?")) void run(() => deleteArtifactAction(eventId, artifactId));
        }}
      >
        Borrar
      </Button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export function ObservationForm({
  eventId,
  teamId,
  members,
}: {
  eventId: string;
  teamId: string;
  members: { participationId: string; name: string }[];
}) {
  const [participationId, setParticipationId] = useState("");
  const [capability, setCapability] = useState<Capability | "">("");
  const [observer, setObserver] = useState<ObserverSource>("FOUNDER_INDIVIDUAL");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const { run, pending, error } = useActionRunner();

  return (
    <div className="space-y-3">
      <p className="font-semibold">¿Hubo alguna contribución individual especialmente valiosa?</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Participante" htmlFor={`obs-p-${teamId}`}>
          <Select id={`obs-p-${teamId}`} value={participationId} onChange={(e) => setParticipationId(e.target.value)}>
            <option value="">Elegí…</option>
            {members.map((m) => (
              <option key={m.participationId} value={m.participationId}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Capacidad observada" htmlFor={`obs-c-${teamId}`}>
          <Select id={`obs-c-${teamId}`} value={capability} onChange={(e) => setCapability(e.target.value as Capability)}>
            <option value="">Elegí…</option>
            {CAPABILITIES.map((c) => (
              <option key={c} value={c}>
                {CAPABILITY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quién lo observó" htmlFor={`obs-o-${teamId}`}>
          <Select id={`obs-o-${teamId}`} value={observer} onChange={(e) => setObserver(e.target.value as ObserverSource)}>
            <option value="FOUNDER_INDIVIDUAL">Founder</option>
            <option value="FACILITATOR_OBSERVATION">Facilitador/a</option>
          </Select>
        </Field>
        <Field label="Nota (opcional)" htmlFor={`obs-n-${teamId}`}>
          <TextArea id={`obs-n-${teamId}`} className="min-h-12" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {saved && !pending ? <Notice tone="success">Observación registrada.</Notice> : null}
      <Button
        size="md"
        variant="secondary"
        disabled={!participationId || !capability}
        pending={pending}
        onClick={async () => {
          setSaved(false);
          const res = await run(() =>
            addObservationAction(eventId, teamId, {
              participationId,
              capability: capability as Capability,
              observerSource: observer,
              note: note.trim() || null,
            }),
          );
          if (res?.ok) {
            setSaved(true);
            setNote("");
            setCapability("");
            setParticipationId("");
          }
        }}
      >
        Registrar contribución
      </Button>
    </div>
  );
}

export function DeleteObservationButton({ eventId, observationId }: { eventId: string; observationId: string }) {
  const { run, pending, error } = useActionRunner();
  return (
    <span>
      <Button
        size="sm"
        variant="ghost"
        pending={pending}
        onClick={() => {
          if (confirm("¿Borrar esta observación?")) void run(() => deleteObservationAction(eventId, observationId));
        }}
      >
        Borrar
      </Button>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </span>
  );
}
