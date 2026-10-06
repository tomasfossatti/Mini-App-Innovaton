import { getDb } from "@/lib/db/client";
import type { ReflectionAction } from "@/lib/domain/constants";
import { OUTCOME_DISCLAIMER, REFLECTION_ACTION_PAST, startingPointText } from "@/lib/domain/copy";
import { joinEs } from "@/lib/domain/text";
import { getOutcome } from "@/lib/services/reflection";
import { loadParticipantStep } from "@/lib/participant-page";
import { CommunityCta } from "@/components/participant/CommunityCta";
import { ModeBadge } from "@/components/participant/ModeBadge";
import { ParticipantShell } from "@/components/participant/ParticipantShell";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";

function whatYouDid(actions: ReflectionAction[]): string {
  const concrete = actions.filter((a) => a !== "OTHER");
  if (concrete.length === 0) return "Durante el desafío hiciste un aporte propio.";
  return `Durante el desafío ${joinEs(concrete.map((a) => REFLECTION_ACTION_PAST[a]))}.`;
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="space-y-2">
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </Card>
  );
}

export default async function OutcomePage(props: PageProps<"/e/[eventSlug]/outcome">) {
  const { eventSlug } = await props.params;
  const { event, participation } = await loadParticipantStep(eventSlug, "outcome");
  const outcome = await getOutcome(getDb(), participation.id);

  if (!outcome) {
    return (
      <ParticipantShell eventName={event.name}>
        <Notice tone="warn" title="Todavía estamos procesando tu reflexión">
          Actualizá la página en unos segundos.
        </Notice>
      </ParticipantShell>
    );
  }

  const { interpretation, recommendation, reflection } = outcome;
  return (
    <ParticipantShell eventName={event.name}>
      <div className="space-y-4">
        <h1 className="text-3xl font-extrabold tracking-tight">Lo que mostró tu experiencia</h1>

        <Block title="Tu punto de partida">
          {outcome.initialMode ? <ModeBadge mode={outcome.initialMode} className="text-base" /> : null}
          <p className="text-lg">{startingPointText(outcome.initialMode)}</p>
        </Block>

        <Block title="Lo que hiciste">
          <p className="text-lg">{whatYouDid(reflection.selectedActions)}</p>
          {reflection.primaryContributionText ? (
            <blockquote className="border-l-4 border-accent pl-3 text-base italic text-muted">
              “{reflection.primaryContributionText}”
            </blockquote>
          ) : null}
        </Block>

        <Block title="Lo que esta experiencia sugiere">
          <p className="text-lg font-semibold leading-snug">{interpretation.summary}</p>
          <p className="text-sm text-muted">{OUTCOME_DISCLAIMER}</p>
        </Block>

        <Card className="space-y-2 border-accent bg-accent-soft">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink/70">Próximo experimento</h2>
          <p className="text-xl font-bold leading-snug">{recommendation.action}</p>
          <p className="text-base text-ink/80">{recommendation.rationale}</p>
        </Card>

        <CommunityCta eventSlug={event.slug} done={outcome.communityCtaDone} communityUrl={event.communityUrl} />
      </div>
    </ParticipantShell>
  );
}
