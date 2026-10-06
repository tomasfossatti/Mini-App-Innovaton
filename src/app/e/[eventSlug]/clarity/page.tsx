import { loadParticipantStep } from "@/lib/participant-page";
import { ClarityStep } from "@/components/participant/ClarityStep";
import { ParticipantShell } from "@/components/participant/ParticipantShell";

export default async function ClarityPage(props: PageProps<"/e/[eventSlug]/clarity">) {
  const { eventSlug } = await props.params;
  const { event, participation } = await loadParticipantStep(eventSlug, "clarity");
  return (
    <ParticipantShell eventName={event.name}>
      <div className="flex flex-1 flex-col justify-center gap-8">
        <h1 className="text-2xl font-bold leading-snug">
          Cuando trabajás con otras personas sobre un problema nuevo, ¿qué tan claro tenés cuál suele ser tu aporte
          para que el equipo avance?
        </h1>
        <ClarityStep eventSlug={event.slug} initial={participation.preClarity} />
      </div>
    </ParticipantShell>
  );
}
