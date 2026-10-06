import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/staff";
import { getDb } from "@/lib/db/client";
import { MODE_LABELS, MODE_SHORT, PRIMARY_CONTRIBUTION_OPTIONS, REFLECTION_ACTION_LABELS, standPhrase } from "@/lib/domain/copy";
import { REFLECTION_ACTIONS } from "@/lib/domain/constants";
import { QUESTIONS, TIEBREAK_OPTIONS, TIEBREAK_PROMPT } from "@/lib/domain/questionnaire";
import { formatTime } from "@/lib/domain/time";
import { getEventById } from "@/lib/services/events";
import { getPrintData } from "@/lib/services/export";
import { PrintButton } from "@/components/staff/PrintButton";

export const metadata: Metadata = { title: "Kit analógico" };

const LETTERS = ["A", "B", "C"];

function Sheet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="print-break space-y-4 pt-6">
      <h2 className="text-2xl font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

function Line({ label }: { label: string }) {
  return (
    <p className="flex items-end gap-2">
      <span className="font-semibold">{label}</span>
      <span className="mb-1 flex-1 border-b border-ink" />
    </p>
  );
}

/** Contingencia analógica (03 §13): todo lo necesario para seguir sin internet. */
export default async function AnalogKitPage(props: PageProps<"/staff/events/[eventId]/print/kit">) {
  await requireStaffPage();
  const { eventId } = await props.params;
  const db = getDb();
  const event = await getEventById(db, eventId);
  if (!event) notFound();
  const data = await getPrintData(db, event.id);
  const tz = event.timezone;
  // Orden de opciones fijo pero distinto por pregunta, para que la letra no delate el modo.
  const ordered = QUESTIONS.map((q, i) => ({
    ...q,
    options: q.options.map((_, j) => q.options[(j + i) % q.options.length]),
  }));

  return (
    <div className="space-y-6 bg-paper p-4 text-ink print:p-0">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted">
          Kit analógico: cuestionario, clave E/C/I, inscripción, evaluación del founder y reflexión en papel. Los datos se
          pueden cargar después con el alta rápida.
        </p>
        <div className="flex items-center gap-3">
          <Link href={`/staff/events/${event.id}/print`} className="font-semibold text-brand underline underline-offset-4">
            ← Hojas del evento
          </Link>
          <PrintButton />
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="text-2xl font-extrabold">Cuestionario · ¿Cómo podés aportar?</h2>
        <p>Marcá una opción por pregunta. No es un test de personalidad ni define quién sos.</p>
        <Line label="Nombre" />
        {ordered.map((q, i) => (
          <div key={q.key} className="break-inside-avoid space-y-1">
            <p className="font-bold">
              {i + 1}. {q.prompt}
            </p>
            {q.options.map((o, j) => (
              <p key={o.mode} className="pl-4">
                ☐ {LETTERS[j]}) {o.text}
              </p>
            ))}
          </div>
        ))}
        <div className="break-inside-avoid space-y-1">
          <p className="font-bold">Solo si hay empate: {TIEBREAK_PROMPT}</p>
          {Object.values(TIEBREAK_OPTIONS).map((o) => (
            <p key={o.label} className="pl-4">
              ☐ {o.text}
            </p>
          ))}
        </div>
      </section>

      <Sheet title="Clave E/C/I (solo staff)">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-ink">
              <th className="py-1">Pregunta</th>
              {LETTERS.map((l) => (
                <th key={l} className="py-1">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered.map((q, i) => (
              <tr key={q.key} className="border-b border-line">
                <td className="py-1">{i + 1}</td>
                {q.options.map((o) => (
                  <td key={o.mode} className="py-1 font-bold">
                    {MODE_SHORT[o.mode]} · {MODE_LABELS[o.mode]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Cada respuesta suma 1 a su modo. Gana el mayor puntaje. Si queda 2–2–1, se usa la pregunta de desempate entre los
          dos empatados.
        </p>
      </Sheet>

      <Sheet title="Inscripción en papel">
        <p>
          Volvé al {standPhrase(event.locationLabel)} entre {formatTime(event.checkinOpensAt, tz)} y {formatTime(event.registrationClosesAt, tz)}. A
          las {formatTime(event.startsAt, tz)} empezamos.
        </p>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="grid break-inside-avoid grid-cols-2 gap-x-6 gap-y-3 rounded border border-ink p-3">
            <Line label="Nombre" />
            <Line label="WhatsApp" />
            <Line label="Desafío 1" />
            <Line label="Desafío 2 / cualquiera" />
            <Line label="Modo (E/C/I)" />
            <p>☐ Mensajes operativos ☐ Oportunidades Espacio IDI</p>
          </div>
        ))}
        <p className="text-sm">Desafíos: {data.challenges.map((c) => c.startupName).join(" · ")}</p>
      </Sheet>

      <Sheet title="Evaluación del founder">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-ink">
              <th className="py-2">Mesa</th>
              <th className="py-2">Startup / equipo</th>
              <th className="py-2">Problema 1–5</th>
              <th className="py-2">Valor 1–5</th>
              <th className="py-2">Prueba 1–5</th>
              <th className="py-2">Reconocimiento</th>
            </tr>
          </thead>
          <tbody>
            {(data.teams.length ? data.teams : Array.from({ length: 10 }, () => null)).map((t, i) => (
              <tr key={i} className="h-12 border-b border-line">
                <td>{t?.tableNumber ?? ""}</td>
                <td>{t ? `${t.startupName} · Eq. ${t.teamNumber}` : ""}</td>
                <td />
                <td />
                <td />
                <td>☐</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-sm">¿Hubo alguna contribución individual especialmente valiosa? Participante, capacidad observada y nota:</p>
        <Line label="1." />
        <Line label="2." />
      </Sheet>

      <Sheet title="Reflexión final">
        <Line label="Nombre" />
        <p className="font-bold">1. Ahora que terminaste, ¿qué tan claro tenés cómo aportaste para que el equipo avanzara?</p>
        <p className="pl-4">Nada claro ☐1 ☐2 ☐3 ☐4 ☐5 Muy claro</p>
        <p className="font-bold">2. ¿Qué hiciste concretamente durante el desafío? (podés marcar varias)</p>
        <div className="grid grid-cols-2 gap-1 pl-4">
          {REFLECTION_ACTIONS.map((a) => (
            <p key={a}>☐ {REFLECTION_ACTION_LABELS[a]}</p>
          ))}
        </div>
        <p className="font-bold">3. ¿Cuál sentís que fue tu aporte más importante?</p>
        <Line label="" />
        <div className="grid grid-cols-3 gap-1 pl-4">
          {PRIMARY_CONTRIBUTION_OPTIONS.map((o) => (
            <p key={o.capability}>☐ {o.label}</p>
          ))}
        </div>
        <p className="font-bold">4. ¿Sentís que tu aporte ayudó al equipo?</p>
        <p className="pl-4">Nada ☐1 ☐2 ☐3 ☐4 ☐5 Mucho</p>
        <p className="font-bold">5. ¿La sugerencia que recibiste al comienzo te ayudó a encontrar una forma de participar?</p>
        <p className="pl-4">Nada ☐1 ☐2 ☐3 ☐4 ☐5 Mucho</p>
      </Sheet>
    </div>
  );
}
