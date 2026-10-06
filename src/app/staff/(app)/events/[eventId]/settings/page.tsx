import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createChallengeAction, updateChallengeAction, updateEventAction } from "@/actions/admin";
import { requireStaffPage } from "@/lib/auth/staff";
import { getDb } from "@/lib/db/client";
import { formatIsoDate, formatTime } from "@/lib/domain/time";
import { getEventById, listChallenges } from "@/lib/services/events";
import { ChallengeForm } from "@/components/staff/ChallengeForm";
import { DeleteChallengeButton } from "@/components/staff/DeleteChallengeButton";
import { EventForm } from "@/components/staff/EventForm";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";

export const metadata: Metadata = { title: "Configuración" };

export default async function EventSettingsPage(props: PageProps<"/staff/events/[eventId]/settings">) {
  await requireStaffPage("ADMIN");
  const { eventId } = await props.params;
  const db = getDb();
  const event = await getEventById(db, eventId);
  if (!event) notFound();
  const challenges = await listChallenges(db, event.id);
  const tz = event.timezone;
  const hasDemo = challenges.some((c) => c.active && c.startupName.toUpperCase().startsWith("DEMO"));

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-4 text-lg font-bold">Datos del evento</h2>
        <EventForm
          action={updateEventAction.bind(null, event.id)}
          submitLabel="Guardar evento"
          values={{
            name: event.name,
            slug: event.slug,
            date: formatIsoDate(event.startsAt, tz),
            timezone: tz,
            locationLabel: event.locationLabel,
            registrationOpens: formatTime(event.registrationOpensAt, tz),
            checkinOpens: formatTime(event.checkinOpensAt, tz),
            registrationCloses: formatTime(event.registrationClosesAt, tz),
            starts: formatTime(event.startsAt, tz),
            ends: formatTime(event.endsAt, tz),
            communityUrl: event.communityUrl ?? "",
          }}
        />
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Desafíos ({challenges.length})</h2>
        {hasDemo ? (
          <Notice tone="warn" title="Hay desafíos DEMO activos">
            Antes del evento real, desactivá o borrá los desafíos DEMO y cargá los briefs validados con cada founder.
          </Notice>
        ) : null}
        {challenges.length === 0 ? (
          <Card>
            <p className="text-muted">Todavía no hay desafíos. Cargá el primero abajo.</p>
          </Card>
        ) : null}
        {challenges.map((c) => (
          <Card key={c.id}>
            <details>
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                <span className="font-bold">{c.startupName}</span>
                <Badge tone={c.active ? "ok" : "neutral"}>{c.active ? "Activo" : "Inactivo"}</Badge>
                <span className="text-sm text-muted">orden {c.sortOrder}</span>
                <span className="w-full text-sm text-muted">{c.title}</span>
              </summary>
              <div className="mt-4 space-y-4">
                <ChallengeForm
                  idPrefix={`ch-${c.id}`}
                  action={updateChallengeAction.bind(null, event.id, c.id)}
                  submitLabel="Guardar desafío"
                  values={{
                    startupName: c.startupName,
                    title: c.title,
                    description: c.description,
                    brief: c.brief,
                    prize: c.prize ?? "",
                    sortOrder: c.sortOrder,
                    active: c.active,
                  }}
                />
                <DeleteChallengeButton eventId={event.id} challengeId={c.id} />
              </div>
            </details>
          </Card>
        ))}
        <Card>
          <h3 className="mb-4 text-lg font-bold">Nuevo desafío</h3>
          <ChallengeForm
            idPrefix="new-challenge"
            resetOnSuccess
            action={createChallengeAction.bind(null, event.id)}
            submitLabel="Agregar desafío"
            values={{
              startupName: "",
              title: "",
              description: "",
              brief: "",
              prize: "",
              sortOrder: (challenges.at(-1)?.sortOrder ?? 0) + 1,
              active: true,
            }}
          />
        </Card>
      </section>
    </div>
  );
}
