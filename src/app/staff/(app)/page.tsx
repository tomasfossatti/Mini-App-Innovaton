import type { Metadata } from "next";
import Link from "next/link";
import { createEventAction } from "@/actions/admin";
import { requireStaffPage } from "@/lib/auth/staff";
import { getDb } from "@/lib/db/client";
import { formatDate, formatTime } from "@/lib/domain/time";
import { listEvents } from "@/lib/services/events";
import { DEFAULT_EVENT_VALUES, EventForm } from "@/components/staff/EventForm";
import { PHASE_LABELS } from "@/components/staff/phase";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Eventos" };

export default async function StaffHomePage() {
  const staff = await requireStaffPage();
  const events = await listEvents(getDb());
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Eventos</h1>
      {events.length === 0 ? (
        <Card>
          <p className="font-semibold">Todavía no hay eventos.</p>
          <p className="mt-1 text-muted">
            {staff.role === "ADMIN"
              ? "Creá el primero con el formulario de abajo."
              : "Pedile a una persona ADMIN que cree el evento."}
          </p>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {events.map((event) => (
            <li key={event.id}>
              <Link href={`/staff/events/${event.id}`} className="block">
                <Card className="transition hover:border-brand">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-lg font-bold">{event.name}</h2>
                    <Badge tone={event.phase === "CLOSED" || event.phase === "DRAFT" ? "neutral" : "brand"}>
                      {PHASE_LABELS[event.phase]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {formatDate(event.startsAt, event.timezone)} · {formatTime(event.startsAt, event.timezone)} ·
                    /e/{event.slug}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {staff.role === "ADMIN" ? (
        <Card>
          <h2 className="mb-4 text-lg font-bold">Nuevo evento</h2>
          <EventForm action={createEventAction} values={DEFAULT_EVENT_VALUES} submitLabel="Crear evento" />
          <p className="mt-3 text-sm text-muted">
            El evento se crea en estado Borrador. Después cargás los desafíos y abrís la inscripción desde el panel.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
