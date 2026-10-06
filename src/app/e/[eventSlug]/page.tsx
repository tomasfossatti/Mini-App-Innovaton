import Link from "next/link";
import { nextStep, stepPath } from "@/lib/domain/flow";
import { PHASES_OPEN_FOR_START } from "@/lib/domain/constants";
import { formatDate, formatTime } from "@/lib/domain/time";
import { loadEventOr404, loadOptionalParticipation } from "@/lib/participant-page";
import { ParticipantShell } from "@/components/participant/ParticipantShell";
import { StartButton } from "@/components/participant/StartButton";
import { LinkButton } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";

export default async function LandingPage(props: PageProps<"/e/[eventSlug]">) {
  const { eventSlug } = await props.params;
  const event = await loadEventOr404(eventSlug);
  const participation = await loadOptionalParticipation(event);
  const open = PHASES_OPEN_FOR_START.includes(event.phase);
  const late = event.phase === "MATCHING" || event.phase === "SPRINT";
  const tz = event.timezone;

  return (
    <ParticipantShell eventName={event.name}>
      <div className="flex flex-1 flex-col justify-center gap-6 py-6">
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight">
          Descubrí cómo podés aportar cuando resolvés un problema real.
        </h1>
        <p className="text-lg text-muted">
          En menos de 2 minutos te proponemos una forma de entrar al desafío. Después vas a ponerla a prueba con
          otras personas y una startup real.
        </p>
        <p className="text-sm font-medium text-muted">
          {formatDate(event.startsAt, tz)} · {formatTime(event.startsAt, tz)} · {event.locationLabel}
        </p>

        {participation ? (
          <div className="space-y-3">
            <LinkButton href={stepPath(event.slug, nextStep(participation))}>CONTINUAR</LinkButton>
            <p className="text-center text-sm text-muted">Retomás desde donde dejaste.</p>
          </div>
        ) : open ? (
          <div className="space-y-3">
            {late ? (
              <Notice tone="warn" title="La inscripción para el matching ya cerró">
                Si llegaste recién, acercate al stand: el staff te suma a un equipo si es posible.
              </Notice>
            ) : null}
            <StartButton eventSlug={event.slug} label="DESCUBRIR CÓMO PUEDO APORTAR" />
            <p className="text-center text-sm text-muted">No es un test de personalidad ni define quién sos.</p>
          </div>
        ) : (
          <Notice tone="info" title={event.phase === "DRAFT" ? "Todavía no abrió la inscripción" : "La inscripción cerró"}>
            {event.phase === "DRAFT"
              ? `Volvé a partir de las ${formatTime(event.registrationOpensAt, tz)}.`
              : "Si te inscribiste, recuperá tu lugar con tu WhatsApp."}
          </Notice>
        )}

        {!participation ? (
          <Link
            href={`/e/${event.slug}/recover`}
            className="mx-auto min-h-11 content-center text-center font-semibold text-brand underline underline-offset-4"
          >
            ¿Ya te inscribiste? Recuperá tu lugar
          </Link>
        ) : null}
      </div>
    </ParticipantShell>
  );
}
