import { redirect } from "next/navigation";
import { MODE_RESULT, RESULT_INTRO } from "@/lib/domain/copy";
import { stepPath } from "@/lib/domain/flow";
import { loadParticipantStep } from "@/lib/participant-page";
import { ModeBadge } from "@/components/participant/ModeBadge";
import { ParticipantShell } from "@/components/participant/ParticipantShell";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default async function ResultPage(props: PageProps<"/e/[eventSlug]/result">) {
  const { eventSlug } = await props.params;
  const { event, participation } = await loadParticipantStep(eventSlug, "result");
  const mode = participation.initialMode;
  if (!mode) redirect(stepPath(event.slug, "assessment"));
  const result = MODE_RESULT[mode];

  return (
    <ParticipantShell
      eventName={event.name}
      footer={<LinkButton href={stepPath(event.slug, "challenges")}>ELEGIR UN DESAFÍO</LinkButton>}
    >
      <div className="flex flex-1 flex-col gap-6 py-2">
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight">{RESULT_INTRO.heading}</h1>
          <p className="text-lg text-muted">{RESULT_INTRO.body}</p>
        </div>
        <Card className="space-y-4">
          <ModeBadge mode={mode} />
          <p className="text-2xl font-bold leading-snug">{result.headline}</p>
          <div className="rounded-2xl bg-accent-soft p-4">
            <p className="text-sm font-bold uppercase tracking-wide text-ink/70">Tu misión de hoy</p>
            <p className="mt-1 text-lg font-semibold">{result.mission}</p>
          </div>
        </Card>
        <p className="text-sm text-muted">
          Es una hipótesis para entrar al desafío. Lo que hagas en el equipo es lo que vamos a mirar al final.
        </p>
      </div>
    </ParticipantShell>
  );
}
