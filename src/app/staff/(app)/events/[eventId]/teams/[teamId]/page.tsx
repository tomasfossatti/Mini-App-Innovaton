import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/staff";
import { getDb } from "@/lib/db/client";
import { CAPABILITY_LABELS, MODE_SHORT } from "@/lib/domain/copy";
import { PHASES_OPEN_FOR_REFLECTION } from "@/lib/domain/constants";
import { formatTime } from "@/lib/domain/time";
import { getEventById } from "@/lib/services/events";
import { getTeamDetail } from "@/lib/services/founder";
import { A3Uploader } from "@/components/staff/A3Uploader";
import { StaffReflectionForm } from "@/components/staff/StaffReflectionForm";
import { SOURCE_LABELS, STATUS_LABELS } from "@/components/staff/labels";
import {
  A3BlocksForm,
  AssessmentForm,
  DeleteArtifactButton,
  DeleteObservationButton,
  ObservationForm,
} from "@/components/staff/TeamEvaluation";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Equipo" };

export default async function TeamDetailPage(props: PageProps<"/staff/events/[eventId]/teams/[teamId]">) {
  await requireStaffPage();
  const { eventId, teamId } = await props.params;
  const db = getDb();
  const event = await getEventById(db, eventId);
  if (!event) notFound();
  const detail = await getTeamDetail(db, event.id, teamId);
  if (!detail) notFound();
  const { team, challenge, members, artifacts, assessment, observations, siblings } = detail;
  const reflectionOpen = PHASES_OPEN_FOR_REFLECTION.includes(detail.eventPhase);
  const withoutReflection = members.filter((m) => !m.hasReflection);
  const base = `/staff/events/${event.id}/teams`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`${base}?challenge=${challenge.id}`} className="font-semibold text-brand underline-offset-4 hover:underline">
          ← Equipos de {challenge.startupName}
        </Link>
        {siblings.length ? <span className="text-muted">·</span> : null}
        {siblings.map((s) => (
          <Link key={s.id} href={`${base}/${s.id}`} className="rounded-full border border-line bg-paper px-3 py-1 font-semibold">
            Eq. {s.teamNumber} · Mesa {s.tableNumber}
          </Link>
        ))}
      </div>

      <Card className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">{challenge.startupName}</p>
        <h2 className="text-3xl font-extrabold">
          Equipo {team.teamNumber} · Mesa {team.tableNumber}
        </h2>
        <p className="text-base">{challenge.title}</p>
        {members.length === 0 ? (
          <p className="text-muted">Este equipo todavía no tiene integrantes.</p>
        ) : (
          <ul className="divide-y divide-line">
            {members.map((m) => (
              <li key={m.participationId} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-semibold">{m.name}</span>
                {m.initialMode ? <Badge>{MODE_SHORT[m.initialMode]}</Badge> : null}
                {m.assignmentSource ? <Badge>{SOURCE_LABELS[m.assignmentSource]}</Badge> : null}
                <Badge tone={STATUS_LABELS[m.status].tone}>{STATUS_LABELS[m.status].label}</Badge>
                {m.hasReflection ? <Badge tone="ok">Reflexión hecha</Badge> : null}
              </li>
            ))}
          </ul>
        )}
        {challenge.brief ? (
          <details>
            <summary className="cursor-pointer font-semibold text-brand">Ver brief del desafío</summary>
            <p className="mt-2 whitespace-pre-line text-sm">{challenge.brief}</p>
            {challenge.prize ? <p className="mt-2 text-sm"><strong>Premio:</strong> {challenge.prize}</p> : null}
          </details>
        ) : null}
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-bold">A3</h2>
        <A3Uploader teamId={team.id} />
        {artifacts.length ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {artifacts.map((a) => (
              <li key={a.id} className="space-y-1">
                <a href={`/api/staff/artifacts/${a.id}`} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- imagen privada servida por route autenticada */}
                  <img
                    src={`/api/staff/artifacts/${a.id}`}
                    alt={`A3 del equipo ${team.teamNumber}`}
                    loading="lazy"
                    className="aspect-[4/3] w-full rounded-xl border border-line object-cover"
                  />
                </a>
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{formatTime(a.createdAt, event.timezone)} · {Math.round(a.sizeBytes / 1024)} KB</span>
                  <DeleteArtifactButton eventId={event.id} artifactId={a.id} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Todavía no hay fotos del A3.</p>
        )}
        <A3BlocksForm eventId={event.id} teamId={team.id} initial={team.a3Blocks} />
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-bold">Evaluación del founder</h2>
        {assessment ? (
          <p className="text-sm text-muted">Última actualización: {formatTime(assessment.updatedAt, event.timezone)}</p>
        ) : (
          <p className="text-sm text-muted">Sin evaluación todavía. Se puede cargar más tarde.</p>
        )}
        <AssessmentForm
          version={assessment ? assessment.updatedAt.toISOString() : null}
          eventId={event.id}
          teamId={team.id}
          initial={
            assessment
              ? {
                  problemScore: assessment.problemScore,
                  valueScore: assessment.valueScore,
                  testScore: assessment.testScore,
                  feedback: assessment.feedback,
                  winner: assessment.winner,
                }
              : null
          }
        />
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-bold">Contribución individual (opcional)</h2>
        {observations.length ? (
          <ul className="divide-y divide-line">
            {observations.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{o.name}</strong> · {CAPABILITY_LABELS[o.capability]} ·{" "}
                  <span className="text-muted">{o.observerSource === "FOUNDER_INDIVIDUAL" ? "founder" : "facilitación"}</span>
                  {o.note ? <span className="block text-sm text-muted">{o.note}</span> : null}
                </span>
                <DeleteObservationButton eventId={event.id} observationId={o.id} />
              </li>
            ))}
          </ul>
        ) : null}
        {members.length ? (
          <ObservationForm
            eventId={event.id}
            teamId={team.id}
            members={members.map((m) => ({ participationId: m.participationId, name: m.name }))}
          />
        ) : null}
      </Card>

      {withoutReflection.length ? (
        <Card className="space-y-3">
          <h2 className="text-lg font-bold">Reflexión en papel</h2>
          {reflectionOpen ? (
            <>
              <p className="text-sm text-muted">
                Para quien hizo la reflexión en papel o no tiene celular. Se interpreta igual que la del celular.
              </p>
              {withoutReflection.map((m) => (
                <details key={m.participationId}>
                  <summary className="min-h-11 cursor-pointer content-center font-semibold text-brand">
                    Cargar la reflexión de {m.name}
                  </summary>
                  <div className="mt-2">
                    <StaffReflectionForm eventId={event.id} participationId={m.participationId} name={m.name} />
                  </div>
                </details>
              ))}
            </>
          ) : (
            <p className="text-sm text-muted">Se habilita cuando se abre la reflexión (después de los pitches).</p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
