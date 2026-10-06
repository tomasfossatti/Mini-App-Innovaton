"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { finalizeAssessmentAction, saveAnswerAction, saveTieBreakAction } from "@/actions/participant";
import type { Mode } from "@/lib/domain/constants";
import { Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/components/ui/cn";
import { ActionError } from "@/components/ui/ActionError";
import { useActionRunner } from "@/components/ui/useActionRunner";

export interface AssessmentQuestion {
  key: string;
  prompt: string;
  options: { mode: Mode; text: string }[];
}

export interface TieOption {
  mode: Mode;
  label: string;
  text: string;
}

export function AssessmentFlow({
  eventSlug,
  questions,
  initialAnswers,
  tieOptions: initialTie,
  tiebreakPrompt,
  allTieOptions,
}: {
  eventSlug: string;
  questions: AssessmentQuestion[];
  initialAnswers: Record<string, Mode>;
  tieOptions: TieOption[] | null;
  tiebreakPrompt: string;
  allTieOptions: Record<Mode, TieOption>;
}) {
  const router = useRouter();
  const total = questions.length;
  const firstPending = questions.findIndex((q) => !initialAnswers[q.key]);
  const [answers, setAnswers] = useState<Record<string, Mode>>(initialAnswers);
  const [index, setIndex] = useState(firstPending === -1 ? total - 1 : firstPending);
  const [tie, setTie] = useState<TieOption[] | null>(firstPending === -1 ? initialTie : null);
  const [flash, setFlash] = useState<Mode | null>(null);
  // Cubre la espera de los guardados en segundo plano antes de finalizar (red lenta).
  const [finishing, setFinishing] = useState(false);
  const pendingSaves = useRef<Promise<unknown>[]>([]);
  const { run, pending, error, needsReload } = useActionRunner();

  const question = questions[index];

  async function finalize(all: Record<string, Mode>) {
    setFinishing(true);
    await Promise.allSettled(pendingSaves.current);
    pendingSaves.current = [];
    const res = await run(() => finalizeAssessmentAction(eventSlug, all));
    if (res?.ok && res.data.kind === "RESOLVED") {
      // Se mantiene el estado de espera mientras navega al resultado.
      router.push(res.data.next);
      return;
    }
    setFinishing(false);
    if (res?.ok && res.data.kind === "TIE") {
      setTie(res.data.modes.map((m) => allTieOptions[m as Mode]));
    }
  }

  function choose(mode: Mode) {
    if (pending || flash || finishing) return;
    const next = { ...answers, [question.key]: mode };
    setAnswers(next);
    setFlash(mode);
    // Guardado en segundo plano para poder retomar si se corta; el final reenvía todo igual.
    pendingSaves.current.push(saveAnswerAction(eventSlug, question.key, mode).catch(() => null));
    window.setTimeout(() => {
      setFlash(null);
      if (index < total - 1) {
        setIndex(index + 1);
        window.scrollTo({ top: 0 });
      } else {
        void finalize(next);
      }
    }, 180);
  }

  async function chooseTie(mode: Mode) {
    const res = await run(() => saveTieBreakAction(eventSlug, mode));
    if (res?.ok) router.push(res.data.next);
  }

  if (tie) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <Progress current={total} total={total} label="Una más y listo" />
        <h1 className="text-2xl font-bold leading-snug">{tiebreakPrompt}</h1>
        <div className="space-y-3">
          {tie.map((o) => (
            <button
              key={o.mode}
              type="button"
              disabled={pending}
              onClick={() => void chooseTie(o.mode)}
              className="block w-full rounded-2xl border-2 border-line bg-paper px-5 py-4 text-left transition active:bg-brand-soft disabled:opacity-60"
            >
              <span className="block text-sm font-bold uppercase tracking-wide text-brand">{o.label}</span>
              <span className="mt-1 block text-lg">{o.text}</span>
            </button>
          ))}
        </div>
        {pending ? (
          <p className="flex items-center gap-2 text-muted" role="status">
            <Spinner className="size-4" /> Guardando…
          </p>
        ) : null}
        <ActionError error={error} needsReload={needsReload} />
      </div>
    );
  }

  const selected = answers[question.key];
  return (
    <div className="flex flex-1 flex-col gap-6">
      <Progress current={index + 1} total={total} />
      <h1 className="text-2xl font-bold leading-snug">{question.prompt}</h1>
      <div className="space-y-3" role="radiogroup" aria-label={question.prompt}>
        {question.options.map((o) => {
          const isSelected = flash ? flash === o.mode : selected === o.mode;
          return (
            <button
              key={o.mode}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={pending || finishing}
              onClick={() => choose(o.mode)}
              className={cn(
                "block min-h-16 w-full rounded-2xl border-2 px-5 py-4 text-left text-lg leading-snug transition disabled:opacity-60",
                isSelected ? "border-brand bg-brand text-white" : "border-line bg-paper active:bg-brand-soft",
              )}
            >
              {o.text}
            </button>
          );
        })}
      </div>
      {pending || finishing ? (
        <p className="flex items-center gap-2 text-muted" role="status">
          <Spinner className="size-4" /> Preparando tu resultado…
        </p>
      ) : null}
      <ActionError error={error} needsReload={needsReload} />
      {/* Con las 5 respuestas dadas (volvió atrás, recargó o falló la red) siempre hay salida. */}
      {index === total - 1 && Object.keys(answers).length === total && !pending && !finishing && !flash ? (
        <Button variant={error ? "secondary" : "primary"} onClick={() => void finalize(answers)}>
          {error ? "Reintentar" : "VER MI RESULTADO"}
        </Button>
      ) : null}
      {index > 0 && !pending && !finishing ? (
        <button
          type="button"
          onClick={() => setIndex(index - 1)}
          className="mt-auto min-h-11 self-start font-semibold text-brand underline underline-offset-4"
        >
          ← Pregunta anterior
        </button>
      ) : null}
    </div>
  );
}
