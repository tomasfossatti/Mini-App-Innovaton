"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveChoicesAction } from "@/actions/participant";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Progress } from "@/components/ui/Progress";
import { cn } from "@/components/ui/cn";
import { useActionRunner } from "@/components/ui/useActionRunner";

export interface PickerChallenge {
  id: string;
  startupName: string;
  description: string;
  title: string;
  prize: string | null;
}

const ANY = "ANY";

function ChallengeCard({
  challenge,
  selected,
  badge,
  onSelect,
}: {
  challenge: PickerChallenge;
  selected: boolean;
  badge?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "block w-full rounded-3xl border-2 bg-paper p-5 text-left transition",
        selected ? "border-brand ring-4 ring-brand/15" : "border-line active:border-brand",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-lg font-extrabold tracking-tight">{challenge.startupName}</span>
        {selected && badge ? (
          <span className="shrink-0 rounded-full bg-brand px-3 py-1 text-xs font-bold text-white">{badge}</span>
        ) : null}
      </div>
      <span className="mt-1 block text-sm text-muted">{challenge.description}</span>
      <span className="mt-3 block text-base font-semibold leading-snug">{challenge.title}</span>
      {challenge.prize ? (
        <span className="mt-3 block text-sm text-muted">
          <span className="font-semibold text-ink">Premio:</span> {challenge.prize}
        </span>
      ) : null}
    </button>
  );
}

export function ChallengePicker({
  eventSlug,
  challenges,
  initial,
}: {
  eventSlug: string;
  challenges: PickerChallenge[];
  initial: { firstChoiceId: string | null; secondChoiceId: string | null; secondChoiceAny: boolean };
}) {
  const router = useRouter();
  const validIds = new Set(challenges.map((c) => c.id));
  const [first, setFirst] = useState<string | null>(
    initial.firstChoiceId && validIds.has(initial.firstChoiceId) ? initial.firstChoiceId : null,
  );
  const [second, setSecond] = useState<string | null>(
    initial.secondChoiceAny
      ? ANY
      : initial.secondChoiceId && validIds.has(initial.secondChoiceId)
        ? initial.secondChoiceId
        : null,
  );
  const [step, setStep] = useState<1 | 2>(1);
  const { run, pending, error } = useActionRunner();

  if (challenges.length === 0) {
    return <Notice tone="warn">Todavía no hay desafíos cargados. Acercate al stand de Espacio IDI.</Notice>;
  }

  const firstChallenge = challenges.find((c) => c.id === first);

  async function save() {
    if (!first || !second) return;
    const res = await run(() =>
      saveChoicesAction(eventSlug, {
        firstChoiceId: first,
        secondChoiceId: second === ANY ? null : second,
        secondChoiceAny: second === ANY,
      }),
    );
    if (res?.ok) router.push(res.data.next);
  }

  if (step === 1) {
    return (
      <div className="flex flex-1 flex-col gap-5">
        <Progress current={1} total={2} label="Primera opción" />
        <div>
          <h1 className="text-2xl font-bold">¿Qué problema te gustaría resolver?</h1>
          <p className="mt-1 text-muted">Elegí tu primera opción.</p>
        </div>
        <div className="space-y-3" role="radiogroup" aria-label="Primera opción">
          {challenges.map((c) => (
            <ChallengeCard
              key={c.id}
              challenge={c}
              selected={first === c.id}
              badge="1ª opción"
              onSelect={() => {
                setFirst(c.id);
                if (second === c.id) setSecond(null);
              }}
            />
          ))}
        </div>
        <div className="sticky bottom-0 -mx-4 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur">
          <Button disabled={!first} onClick={() => { setStep(2); window.scrollTo({ top: 0 }); }}>
            SIGUIENTE
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Progress current={2} total={2} label="Segunda opción" />
      <div>
        <h1 className="text-2xl font-bold">Elegí una segunda opción</h1>
        <p className="mt-1 text-muted">
          Si {firstChallenge?.startupName ?? "tu primera opción"} no llega a formar equipo, te sumamos a la segunda.
        </p>
      </div>
      <div className="space-y-3" role="radiogroup" aria-label="Segunda opción">
        <button
          type="button"
          role="radio"
          aria-checked={second === ANY}
          onClick={() => setSecond(ANY)}
          className={cn(
            "block w-full rounded-3xl border-2 bg-paper p-5 text-left text-lg font-bold transition",
            second === ANY ? "border-brand ring-4 ring-brand/15" : "border-line active:border-brand",
          )}
        >
          Cualquiera, quiero participar
        </button>
        {challenges
          .filter((c) => c.id !== first)
          .map((c) => (
            <ChallengeCard
              key={c.id}
              challenge={c}
              selected={second === c.id}
              badge="2ª opción"
              onSelect={() => setSecond(c.id)}
            />
          ))}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur">
        <Button disabled={!second} pending={pending} pendingLabel="Guardando…" onClick={() => void save()}>
          CONTINUAR
        </Button>
        <button
          type="button"
          onClick={() => setStep(1)}
          className="min-h-11 w-full text-center font-semibold text-brand underline underline-offset-4"
        >
          Cambiar primera opción
        </button>
      </div>
    </div>
  );
}
