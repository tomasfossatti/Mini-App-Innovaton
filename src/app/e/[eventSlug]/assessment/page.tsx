import type { Mode } from "@/lib/domain/constants";
import { QUESTIONS, TIEBREAK_OPTIONS, TIEBREAK_PROMPT, shuffleOptions } from "@/lib/domain/questionnaire";
import { getDb } from "@/lib/db/client";
import { getAnswers } from "@/lib/services/participation";
import { loadParticipantStep } from "@/lib/participant-page";
import { AssessmentFlow, type TieOption } from "@/components/participant/AssessmentFlow";
import { ParticipantShell } from "@/components/participant/ParticipantShell";

export default async function AssessmentPage(props: PageProps<"/e/[eventSlug]/assessment">) {
  const { eventSlug } = await props.params;
  const { event, participation } = await loadParticipantStep(eventSlug, "assessment");
  const answers = await getAnswers(getDb(), participation.id);

  // Orden visual aleatorio pero estable por persona (PRD §7): un refresh no reordena.
  const questions = QUESTIONS.map((q) => ({
    key: q.key,
    prompt: q.prompt,
    options: shuffleOptions(q.options, `${participation.id}:${q.key}`),
  }));
  const allTie = Object.fromEntries(
    (Object.keys(TIEBREAK_OPTIONS) as Mode[]).map((m) => [m, { mode: m, ...TIEBREAK_OPTIONS[m] }]),
  ) as Record<Mode, TieOption>;
  const pendingTie =
    !participation.initialMode && participation.tiebreakModes?.length === 2
      ? shuffleOptions(participation.tiebreakModes, `${participation.id}:TIEBREAK`).map((m) => allTie[m])
      : null;

  return (
    <ParticipantShell eventName={event.name}>
      <AssessmentFlow
        eventSlug={event.slug}
        questions={questions}
        initialAnswers={answers as Record<string, Mode>}
        tieOptions={pendingTie}
        tiebreakPrompt={TIEBREAK_PROMPT}
        allTieOptions={allTie}
      />
    </ParticipantShell>
  );
}
