import { loadParticipantStep } from "@/lib/participant-page";
import { ParticipantShell } from "@/components/participant/ParticipantShell";
import { ReflectionFlow } from "@/components/participant/ReflectionFlow";

export default async function ReflectionPage(props: PageProps<"/e/[eventSlug]/reflection">) {
  const { eventSlug } = await props.params;
  const { event } = await loadParticipantStep(eventSlug, "reflection");
  return (
    <ParticipantShell eventName={event.name}>
      <ReflectionFlow eventSlug={event.slug} />
    </ParticipantShell>
  );
}
