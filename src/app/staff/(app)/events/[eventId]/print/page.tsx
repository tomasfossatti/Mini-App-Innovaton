import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/staff";
import { publicBaseUrl } from "@/lib/base-url";
import { getDb } from "@/lib/db/client";
import { formatDate, formatTime } from "@/lib/domain/time";
import { getEventById } from "@/lib/services/events";
import { getPrintData } from "@/lib/services/export";
import { PrintButton } from "@/components/staff/PrintButton";

export const metadata: Metadata = { title: "Imprimir" };

function Section({ title, children, breakBefore = true }: { title: string; children: React.ReactNode; breakBefore?: boolean }) {
  return (
    <section className={breakBefore ? "print-break space-y-3 pt-6" : "space-y-3"}>
      <h2 className="text-2xl font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

export default async function PrintPage(props: PageProps<"/staff/events/[eventId]/print">) {
  await requireStaffPage();
  const { eventId } = await props.params;
  const db = getDb();
  const event = await getEventById(db, eventId);
  if (!event) notFound();
  const data = await getPrintData(db, event.id);
  const url = `${await publicBaseUrl()}/e/${event.slug}`;
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  const tz = event.timezone;

  return (
    <div className="space-y-6 bg-paper p-4 text-ink print:p-0">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted">
          Material de contingencia: QR, equipos por mesa, tarjetas de mesa, lista de check-in y briefs. Imprimilo antes del
          evento y otra vez después de publicar los equipos.
        </p>
        <div className="flex items-center gap-3">
          <Link href={`/staff/events/${event.id}/print/kit`} className="font-semibold text-brand underline underline-offset-4">
            Kit analógico (cuestionario, clave, reflexión) →
          </Link>
          <PrintButton />
        </div>
      </div>

      <Section title="INNOVATÓN — INSCRIPCIONES" breakBefore={false}>
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-72 max-w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <p className="font-mono text-xl font-bold break-all">{url}</p>
          <p className="text-xl">
            {formatDate(event.startsAt, tz)} · Check-in {formatTime(event.checkinOpensAt, tz)} ·{" "}
            <strong>{formatTime(event.registrationClosesAt, tz)} CIERRAN INSCRIPCIONES</strong>
          </p>
        </div>
      </Section>

      <Section title="Equipos por mesa">
        {data.teams.length === 0 ? (
          <p className="text-muted">Todavía no hay equipos. Volvé a imprimir después de publicarlos.</p>
        ) : (
          <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-ink">
                <th className="py-2 pr-3">Mesa</th>
                <th className="py-2 pr-3">Startup</th>
                <th className="py-2 pr-3">Equipo</th>
                <th className="py-2">Integrantes</th>
              </tr>
            </thead>
            <tbody>
              {data.teams.map((t) => (
                <tr key={`${t.tableNumber}`} className="border-b border-line align-top">
                  <td className="py-2 pr-3 text-2xl font-extrabold">{t.tableNumber}</td>
                  <td className="py-2 pr-3 font-bold">{t.startupName}</td>
                  <td className="py-2 pr-3">Equipo {t.teamNumber}{t.published ? "" : " (borrador)"}</td>
                  <td className="py-2">{t.members.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Section>

      {data.teams.length ? (
        <Section title="Tarjetas de mesa">
          <div className="grid grid-cols-2 gap-4">
            {data.teams.map((t) => (
              <div key={`card-${t.tableNumber}`} className="break-inside-avoid rounded-xl border-4 border-ink p-6 text-center">
                <p className="text-3xl font-extrabold uppercase">{t.startupName}</p>
                <p className="mt-2 text-2xl font-bold">Equipo {t.teamNumber}</p>
                <p className="mt-2 text-xl">Mesa {t.tableNumber}</p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title={`Lista de check-in (${data.people.length})`}>
        <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b-2 border-ink">
              <th className="py-1 pr-2">✓</th>
              <th className="py-1 pr-2">Nombre</th>
              <th className="py-1 pr-2">WhatsApp</th>
              <th className="py-1 pr-2">Desafío 1</th>
              <th className="py-1 pr-2">Desafío 2</th>
              <th className="py-1">Mesa</th>
            </tr>
          </thead>
          <tbody>
            {data.people.map((p, i) => (
              <tr key={`${p.whatsapp}-${i}`} className="border-b border-line">
                <td className="py-1 pr-2">{p.present ? "☑" : "☐"}</td>
                <td className="py-1 pr-2 font-semibold">{p.name}</td>
                <td className="py-1 pr-2 font-mono">{p.whatsapp}</td>
                <td className="py-1 pr-2">{p.firstChoice}</td>
                <td className="py-1 pr-2">{p.secondChoice}</td>
                <td className="py-1">{p.table ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Section>

      {data.challenges.map((c) => (
        <Section key={c.id} title={`Brief · ${c.startupName}`}>
          <p className="text-lg font-semibold">{c.title}</p>
          <p className="whitespace-pre-line text-base">{c.brief || "Brief pendiente."}</p>
          {c.prize ? <p><strong>Premio:</strong> {c.prize}</p> : null}
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            {["Problema — ¿Qué está ocurriendo realmente?", "Hipótesis — ¿Qué proponemos?", "Funcionamiento — ¿Cómo funcionaría?", "Prueba — ¿Cómo sabríamos rápidamente si sirve?"].map(
              (b) => (
                <div key={b} className="min-h-24 rounded border border-ink p-2 font-semibold">
                  {b}
                </div>
              ),
            )}
          </div>
        </Section>
      ))}
    </div>
  );
}
