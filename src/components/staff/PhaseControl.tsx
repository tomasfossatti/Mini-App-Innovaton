"use client";

import Link from "next/link";
import { useState } from "react";
import { setPhaseAction } from "@/actions/staff";
import { EVENT_PHASES, type EventPhase } from "@/lib/domain/constants";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { useActionRunner } from "@/components/ui/useActionRunner";
import { PHASE_LABELS } from "./phase";

const NEXT: Partial<Record<EventPhase, { phase: EventPhase; label: string; confirm: string }>> = {
  DRAFT: { phase: "REGISTRATION", label: "Abrir inscripción", confirm: "¿Abrir la inscripción? El QR empieza a funcionar." },
  REGISTRATION: {
    phase: "CHECKIN",
    label: "Abrir check-in",
    confirm: "¿Abrir el check-in? Quien se inscriba desde ahora queda presente automáticamente.",
  },
  CHECKIN: {
    phase: "MATCHING",
    label: "Cerrar inscripción",
    confirm: "¿Cerrar la inscripción? Desde ahora se trabaja solo con las personas presentes.",
  },
  SPRINT: { phase: "PITCH", label: "Pasar a pitch", confirm: "¿Pasar a la fase de pitch?" },
  PITCH: {
    phase: "REFLECTION",
    label: "Abrir reflexión",
    confirm: "¿Abrir la reflexión final? Los participantes la ven en su celular.",
  },
  REFLECTION: { phase: "CLOSED", label: "Cerrar evento", confirm: "¿Cerrar el evento?" },
};

export function PhaseControl({ eventId, phase }: { eventId: string; phase: EventPhase }) {
  const { run, pending, error } = useActionRunner();
  const [manual, setManual] = useState<EventPhase>(phase);
  const next = NEXT[phase];

  const change = (target: EventPhase, message: string) => {
    if (!confirm(message)) return;
    void run(() => setPhaseAction(eventId, target));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {next ? (
          <Button size="md" pending={pending} onClick={() => change(next.phase, next.confirm)}>
            {next.label}
          </Button>
        ) : null}
        {phase === "MATCHING" ? (
          <Link
            href={`/staff/events/${eventId}/teams`}
            className="inline-flex min-h-12 items-center rounded-2xl bg-brand px-5 font-semibold text-white"
          >
            Generar y publicar equipos →
          </Link>
        ) : null}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-brand">Cambiar fase manualmente</summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select
            value={manual}
            onChange={(e) => setManual(e.target.value as EventPhase)}
            className="max-w-64 py-2 text-base"
            aria-label="Fase"
          >
            {EVENT_PHASES.map((p) => (
              <option key={p} value={p}>
                {PHASE_LABELS[p]}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={manual === phase}
            pending={pending}
            onClick={() => change(manual, `¿Cambiar la fase a "${PHASE_LABELS[manual]}"?`)}
          >
            Aplicar
          </Button>
        </div>
        <p className="mt-1 text-muted">Con equipos publicados no se puede volver a fases anteriores al sprint.</p>
      </details>
    </div>
  );
}
