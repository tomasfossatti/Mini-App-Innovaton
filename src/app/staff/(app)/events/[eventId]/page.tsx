import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/staff";
import { getDb } from "@/lib/db/client";
import type { InterpretationType } from "@/lib/domain/constants";
import { formatTime } from "@/lib/domain/time";
import { getEventById, listChallenges } from "@/lib/services/events";
import { getDashboard, whatsappReminderText } from "@/lib/services/operations";
import { AutoRefresh } from "@/components/staff/AutoRefresh";
import { CopyButton } from "@/components/staff/CopyButton";
import { PeopleList } from "@/components/staff/PeopleList";
import { PhaseControl } from "@/components/staff/PhaseControl";
import { QuickAddForm } from "@/components/staff/QuickAddForm";
import { StatTile } from "@/components/staff/StatTile";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";

export const metadata: Metadata = { title: "Panel" };

const INTERPRETATION_LABELS: Record<InterpretationType, string> = {
  ALIGNED: "Alineada",
  MIXED: "Mixta",
  DIVERGENT: "Divergente",
  INSUFFICIENT: "Insuficiente",
};

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function avg(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

export default async function EventDashboardPage(props: PageProps<"/staff/events/[eventId]">) {
  const staff = await requireStaffPage();
  const isAdmin = staff.role === "ADMIN";
  const { eventId } = await props.params;
  const db = getDb();
  const event = await getEventById(db, eventId);
  if (!event) notFound();
  const [dashboard, challenges] = await Promise.all([
    getDashboard(db, event.id),
    listChallenges(db, event.id, { activeOnly: true }),
  ]);
  const { counts, metrics } = dashboard;
  // Las cuentas STAFF (founders, facilitación) no ven teléfonos completos.
  const people = isAdmin
    ? dashboard.people
    : dashboard.people.map((p) => ({ ...p, whatsapp: `•••• ${p.whatsapp.slice(-4)}`, waNumber: "" }));
  const reminder = whatsappReminderText(event);
  const tz = event.timezone;
  const exportBase = `/api/staff/events/${event.id}`;

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={10} />

      <Card className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">Fase del evento</h2>
          <p className="text-sm text-muted">
            Check-in {formatTime(event.checkinOpensAt, tz)} · cierre {formatTime(event.registrationClosesAt, tz)} · inicio{" "}
            {formatTime(event.startsAt, tz)}
          </p>
        </div>
        {isAdmin ? (
          <PhaseControl key={event.phase} eventId={event.id} phase={event.phase} />
        ) : (
          <p className="text-sm text-muted">Las fases, el matching y los respaldos los maneja una cuenta ADMIN.</p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Registrados" value={counts.registered} hint={`${counts.started} iniciaron`} />
        <StatTile label="Presentes" value={counts.present} />
        <StatTile label="Equipos" value={counts.teams} hint={dashboard.teamsPublished ? "publicados" : "sin publicar"} />
        <StatTile label="Reflexiones" value={counts.reflections} />
      </div>

      {isAdmin ? (
      <Card className="space-y-3">
        <h2 className="text-lg font-bold">Respaldo y contingencia</h2>
        <p className="text-sm text-muted">
          Exportá alrededor de las 14:15 y otra vez justo antes del matching. Si cae internet, el CSV alcanza para seguir
          en papel.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={`${exportBase}/export.csv`} className="inline-flex min-h-12 items-center rounded-2xl bg-brand px-5 font-semibold text-white">
            Descargar CSV
          </a>
          <a href={`${exportBase}/backup.json`} className="inline-flex min-h-12 items-center rounded-2xl border-2 border-line bg-paper px-5 font-semibold">
            Backup completo (JSON)
          </a>
          <a href={`/staff/events/${event.id}/print`} className="inline-flex min-h-12 items-center rounded-2xl border-2 border-line bg-paper px-5 font-semibold">
            Hojas para imprimir y QR
          </a>
        </div>
      </Card>
      ) : null}

      <Card className="space-y-3">
        <h2 className="text-lg font-bold">Por desafío</h2>
        {dashboard.byChallenge.length === 0 ? (
          <Notice tone="warn">No hay desafíos cargados. Cargalos en Configuración.</Notice>
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="px-2 py-2 font-semibold">Startup</th>
                  <th className="px-2 py-2 text-right font-semibold">1ª opción</th>
                  <th className="px-2 py-2 text-right font-semibold">2ª opción</th>
                  <th className="px-2 py-2 text-right font-semibold">Presentes (1ª)</th>
                  <th className="px-2 py-2 text-right font-semibold">Equipos</th>
                  <th className="px-2 py-2 text-right font-semibold">En equipos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {dashboard.byChallenge.map((c) => (
                  <tr key={c.challengeId}>
                    <td className="px-2 py-2 font-semibold">
                      {c.startupName} {!c.active ? <Badge>inactivo</Badge> : null}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{c.firstChoice}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{c.secondChoice}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {c.present}
                      {c.present > 0 && c.present < 3 ? <span className="ml-1 text-warn">(&lt;3)</span> : null}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{c.teams}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{c.assigned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">Participantes</h2>
          {isAdmin ? (
            <span className="text-sm text-muted">Tocá el teléfono para abrir WhatsApp con el recordatorio.</span>
          ) : null}
        </div>
        <PeopleList eventId={event.id} people={people} reminder={reminder} maskedPhones={!isAdmin} />
      </Card>

      <Card>
        <details>
          <summary className="cursor-pointer text-lg font-bold">Alta rápida (sin celular o desde planilla)</summary>
          <div className="mt-4">
            <QuickAddForm eventId={event.id} challenges={challenges.map((c) => ({ id: c.id, startupName: c.startupName }))} />
          </div>
        </details>
      </Card>

      {isAdmin ? (
        <Card className="space-y-3">
          <h2 className="text-lg font-bold">Recordatorio por WhatsApp (manual)</h2>
          <p className="rounded-2xl bg-canvas p-3 text-base">{reminder}</p>
          <CopyButton text={reminder} label="Copiar mensaje" />
        </Card>
      ) : null}

      <Card>
        <details>
          <summary className="cursor-pointer text-lg font-bold">Métricas</summary>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 font-semibold">Funnel</h3>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <dt>Completaron cuestionario</dt>
                <dd className="text-right tabular-nums">{pct(metrics.rates.questionnaireCompletion)}</dd>
                <dt>Se inscribieron</dt>
                <dd className="text-right tabular-nums">{pct(metrics.rates.registration)}</dd>
                <dt>Inscripción → check-in</dt>
                <dd className="text-right tabular-nums">{pct(metrics.rates.registrationToCheckin)}</dd>
                <dt>Check-in → reflexión</dt>
                <dd className="text-right tabular-nums">{pct(metrics.rates.checkinToCompletion)}</dd>
                <dt>Reflexión completada</dt>
                <dd className="text-right tabular-nums">{pct(metrics.rates.reflectionCompletion)}</dd>
                <dt>Conversión comunidad</dt>
                <dd className="text-right tabular-nums">{pct(metrics.rates.communityConversion)}</dd>
              </dl>
            </div>
            <div>
              <h3 className="mb-2 font-semibold">Educai</h3>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <dt>Claridad inicial (prom.)</dt>
                <dd className="text-right tabular-nums">{avg(metrics.educai.avgPreClarity)}</dd>
                <dt>Claridad final (prom.)</dt>
                <dd className="text-right tabular-nums">{avg(metrics.educai.avgPostClarity)}</dd>
                <dt>Delta de claridad</dt>
                <dd className="text-right tabular-nums">{avg(metrics.educai.avgDeltaClarity)}</dd>
                <dt>Utilidad de la hipótesis</dt>
                <dd className="text-right tabular-nums">{avg(metrics.educai.avgInitialModeUsefulness)}</dd>
                <dt>Valor percibido del aporte</dt>
                <dd className="text-right tabular-nums">{avg(metrics.educai.avgPerceivedValue)}</dd>
                <dt>Evidencias registradas</dt>
                <dd className="text-right tabular-nums">{metrics.educai.evidenceItems}</dd>
                <dt>Con interpretación suficiente</dt>
                <dd className="text-right tabular-nums">{pct(metrics.educai.sufficientInterpretationRate)}</dd>
                {(Object.keys(INTERPRETATION_LABELS) as InterpretationType[]).map((t) => (
                  <div key={t} className="contents">
                    <dt className="text-muted">Interpretación {INTERPRETATION_LABELS[t].toLowerCase()}</dt>
                    <dd className="text-right tabular-nums text-muted">{metrics.educai.interpretationTypes[t] ?? 0}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </details>
      </Card>
    </div>
  );
}
