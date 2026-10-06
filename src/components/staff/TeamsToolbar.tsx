"use client";

import { useState } from "react";
import { generateTeamsAction, publishTeamsAction, setPhaseAction } from "@/actions/staff";
import type { EventPhase } from "@/lib/domain/constants";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { useActionRunner } from "@/components/ui/useActionRunner";

interface GenerationSummary {
  teamCount: number;
  assignedCount: number;
  unresolved: { participationId: string; name: string; reason: string }[];
}

export function TeamsToolbar({
  eventId,
  phase,
  published,
  teamCount,
  presentCount,
  unassignedCount,
}: {
  eventId: string;
  phase: EventPhase;
  published: boolean;
  teamCount: number;
  presentCount: number;
  unassignedCount: number;
}) {
  const gen = useActionRunner();
  const pub = useActionRunner();
  const close = useActionRunner();
  const [summary, setSummary] = useState<GenerationSummary | null>(null);

  if (published) {
    return (
      <Notice tone="success" title="Equipos publicados">
        Cada participante ya ve su startup, equipo y mesa. No se regenera: los cambios desde ahora son manuales
        (mover personas, sumar latecomers, crear equipos).
      </Notice>
    );
  }

  if (phase !== "MATCHING") {
    return (
      <div className="space-y-3">
        <Notice tone="info" title="Primero cerrá la inscripción">
          El matching trabaja solo con las personas presentes. Hay {presentCount} presentes ahora.
        </Notice>
        {phase === "CHECKIN" || phase === "REGISTRATION" ? (
          <Button
            size="md"
            pending={close.pending}
            onClick={() => {
              if (confirm("¿Cerrar la inscripción? Desde ahora se trabaja solo con las personas presentes.")) {
                void close.run(() => setPhaseAction(eventId, "MATCHING"));
              }
            }}
          >
            Cerrar inscripción
          </Button>
        ) : null}
        {close.error ? <Notice tone="error">{close.error}</Notice> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          size="md"
          variant={teamCount > 0 ? "secondary" : "primary"}
          pending={gen.pending}
          pendingLabel="Generando…"
          onClick={async () => {
            if (teamCount > 0 && !confirm("¿Regenerar? Se descartan los equipos borrador y sus cambios manuales.")) return;
            const res = await gen.run(() => generateTeamsAction(eventId));
            if (res?.ok) setSummary(res.data);
          }}
        >
          {teamCount > 0 ? "Regenerar equipos" : `Generar equipos (${presentCount} presentes)`}
        </Button>
        {teamCount > 0 ? (
          <Button
            size="md"
            pending={pub.pending}
            pendingLabel="Publicando…"
            onClick={() => {
              const warn = unassignedCount > 0 ? `\n\nHay ${unassignedCount} presentes sin equipo.` : "";
              if (confirm(`¿Publicar los equipos? Después no se puede regenerar.${warn}`)) {
                void pub.run(() => publishTeamsAction(eventId));
              }
            }}
          >
            Publicar equipos
          </Button>
        ) : null}
      </div>
      {gen.error ? <Notice tone="error">{gen.error}</Notice> : null}
      {pub.error ? <Notice tone="error">{pub.error}</Notice> : null}
      {summary ? (
        <Notice tone={summary.unresolved.length ? "warn" : "success"} title={`${summary.teamCount} equipos · ${summary.assignedCount} personas asignadas`}>
          {summary.unresolved.length ? (
            <ul className="mt-1 list-disc pl-5">
              {summary.unresolved.map((u) => (
                <li key={u.participationId}>
                  <strong>{u.name}</strong>: {u.reason}
                </li>
              ))}
            </ul>
          ) : (
            "Todas las personas presentes quedaron en un equipo. Revisá y publicá."
          )}
        </Notice>
      ) : null}
    </div>
  );
}
