import { getDb } from "@/lib/db/client";
import { listChallenges } from "@/lib/services/events";
import { loadParticipantStep } from "@/lib/participant-page";
import { ChallengePicker } from "@/components/participant/ChallengePicker";
import { ParticipantShell } from "@/components/participant/ParticipantShell";

export default async function ChallengesPage(props: PageProps<"/e/[eventSlug]/challenges">) {
  const { eventSlug } = await props.params;
  const { event, participation } = await loadParticipantStep(eventSlug, "challenges");
  const challenges = await listChallenges(getDb(), event.id, { activeOnly: true });
  return (
    <ParticipantShell eventName={event.name}>
      <ChallengePicker
        eventSlug={event.slug}
        challenges={challenges.map((c) => ({
          id: c.id,
          startupName: c.startupName,
          description: c.description,
          title: c.title,
          prize: c.prize,
        }))}
        initial={{
          firstChoiceId: participation.firstChoiceId,
          secondChoiceId: participation.secondChoiceId,
          secondChoiceAny: participation.secondChoiceAny,
        }}
      />
    </ParticipantShell>
  );
}
