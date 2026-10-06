import Link from "next/link";
import { standPhrase } from "@/lib/domain/copy";
import { loadEventOr404 } from "@/lib/participant-page";
import { ParticipantShell } from "@/components/participant/ParticipantShell";
import { RecoverForm } from "@/components/participant/RecoverForm";

export default async function RecoverPage(props: PageProps<"/e/[eventSlug]/recover">) {
  const { eventSlug } = await props.params;
  const event = await loadEventOr404(eventSlug);
  return (
    <ParticipantShell eventName={event.name}>
      <div className="flex flex-1 flex-col gap-5">
        <h1 className="text-2xl font-bold">Recuperá tu lugar</h1>
        <p className="text-muted">
          Si cambiaste de celular o se borró la sesión, pedí un código en el {standPhrase(event.locationLabel)}.
          Ingresalo con tu WhatsApp y seguís desde donde estabas.
        </p>
        <RecoverForm eventSlug={event.slug} />
        <Link href={`/e/${event.slug}`} className="min-h-11 content-center text-center font-semibold text-brand underline underline-offset-4">
          Volver al inicio
        </Link>
      </div>
    </ParticipantShell>
  );
}
