import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { stepPath } from "@/lib/domain/flow";
import { getChallengesByIds } from "@/lib/services/events";
import { loadParticipantStep } from "@/lib/participant-page";
import { ParticipantShell } from "@/components/participant/ParticipantShell";
import { RegisterForm } from "@/components/participant/RegisterForm";

export default async function RegisterPage(props: PageProps<"/e/[eventSlug]/register">) {
  const { eventSlug } = await props.params;
  const { event, participation } = await loadParticipantStep(eventSlug, "register");
  const ids = [participation.firstChoiceId, participation.secondChoiceId].filter((x): x is string => Boolean(x));
  const chosen = await getChallengesByIds(getDb(), event.id, ids);
  const name = (id: string | null) => chosen.find((c) => c.id === id)?.startupName ?? "—";
  const late = event.phase === "MATCHING" || event.phase === "SPRINT";

  return (
    <ParticipantShell eventName={event.name}>
      <div className="flex flex-1 flex-col gap-5">
        <h1 className="text-2xl font-bold">Último paso: tus datos</h1>
        <div className="rounded-2xl border border-line bg-paper p-4 text-base">
          <p>
            <span className="text-muted">1ª opción:</span> <strong>{name(participation.firstChoiceId)}</strong>
          </p>
          <p>
            <span className="text-muted">2ª opción:</span>{" "}
            <strong>{participation.secondChoiceAny ? "Cualquiera" : name(participation.secondChoiceId)}</strong>
          </p>
          <Link href={stepPath(event.slug, "challenges")} className="mt-1 inline-block text-sm font-semibold text-brand underline underline-offset-4">
            Cambiar
          </Link>
        </div>
        <RegisterForm eventSlug={event.slug} late={late} />
      </div>
    </ParticipantShell>
  );
}
