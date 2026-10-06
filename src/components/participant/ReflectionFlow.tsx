"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { submitReflectionAction } from "@/actions/participant";
import type { Capability, ReflectionAction } from "@/lib/domain/constants";
import { PRIMARY_CONTRIBUTION_OPTIONS, REFLECTION_ACTION_LABELS } from "@/lib/domain/copy";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/Field";
import { Progress } from "@/components/ui/Progress";
import { Scale } from "@/components/ui/Scale";
import { cn } from "@/components/ui/cn";
import { ActionError } from "@/components/ui/ActionError";
import { useActionRunner } from "@/components/ui/useActionRunner";

interface Draft {
  step: number;
  postClarity: number | null;
  selectedActions: ReflectionAction[];
  text: string;
  primaryCapability: Capability | null;
  perceivedValue: number | null;
  initialModeUsefulness: number | null;
}

const EMPTY: Draft = {
  step: 0,
  postClarity: null,
  selectedActions: [],
  text: "",
  primaryCapability: null,
  perceivedValue: null,
  initialModeUsefulness: null,
};

const ACTION_ORDER: ReflectionAction[] = [
  "ASKED_QUESTIONS",
  "FOUND_ASSUMPTION",
  "PROPOSED_ALTERNATIVES",
  "CONNECTED_IDEAS",
  "HELPED_CHOOSE",
  "ORGANIZED_TEAM",
  "CREATED_TEST",
  "PRESENTED",
  "OTHER",
];

const TOTAL = 5;

/** Borrador en sessionStorage: un refresh en medio de la reflexión no pierde lo respondido. */
function useDraft(key: string) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hidratación única del borrador local
      if (raw) setDraft({ ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) });
    } catch {
      /* sin storage disponible: se sigue sin borrador */
    }
  }, [key]);
  const update = (patch: Partial<Draft>) =>
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignorar */
      }
      return next;
    });
  const clear = () => {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      /* ignorar */
    }
  };
  return { draft, update, clear };
}

export function ReflectionFlow({ eventSlug }: { eventSlug: string }) {
  const router = useRouter();
  const { draft, update, clear } = useDraft(`innovaton-reflection-${eventSlug}`);
  const { run, pending, error, needsReload } = useActionRunner();
  const step = draft.step;
  // Doble toque en una escala: el segundo toque no debe caer en la pantalla siguiente.
  const [advancing, setAdvancing] = useState(false);
  const chooseAndAdvance = (patch: Partial<Draft>, nextStepIndex: number) => {
    if (advancing) return;
    setAdvancing(true);
    update(patch);
    window.setTimeout(() => {
      update({ step: nextStepIndex });
      window.scrollTo({ top: 0 });
      setAdvancing(false);
    }, 250);
  };

  const go = (n: number) => {
    update({ step: n });
    window.scrollTo({ top: 0 });
  };

  async function submit() {
    if (
      draft.postClarity == null ||
      draft.primaryCapability == null ||
      draft.perceivedValue == null ||
      draft.initialModeUsefulness == null
    ) {
      return;
    }
    const res = await run(() =>
      submitReflectionAction(eventSlug, {
        postClarity: draft.postClarity!,
        selectedActions: draft.selectedActions,
        primaryContributionText: draft.text.trim() || null,
        primaryCapability: draft.primaryCapability!,
        perceivedValue: draft.perceivedValue!,
        initialModeUsefulness: draft.initialModeUsefulness!,
      }),
    );
    if (res?.ok) {
      clear();
      router.push(res.data.next);
    }
  }

  const back =
    step > 0 ? (
      <button
        type="button"
        onClick={() => go(step - 1)}
        className="min-h-11 self-start font-semibold text-brand underline underline-offset-4"
      >
        ← Anterior
      </button>
    ) : null;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Progress current={step + 1} total={TOTAL} />

      {step === 0 ? (
        <>
          <h1 className="text-2xl font-bold leading-snug">
            Ahora que terminaste, ¿qué tan claro tenés cómo aportaste para que el equipo avanzara?
          </h1>
          <Scale
            name="Claridad sobre tu aporte"
            value={draft.postClarity}
            minLabel="Nada claro"
            maxLabel="Muy claro"
            disabled={advancing}
            onChange={(v) => chooseAndAdvance({ postClarity: v }, 1)}
          />
        </>
      ) : null}

      {step === 1 ? (
        <>
          <div>
            <h1 className="text-2xl font-bold leading-snug">¿Qué hiciste concretamente durante el desafío?</h1>
            <p className="mt-1 text-muted">Podés marcar varias.</p>
          </div>
          <div className="space-y-2">
            {ACTION_ORDER.map((a) => {
              const checked = draft.selectedActions.includes(a);
              return (
                <label
                  key={a}
                  className={cn(
                    "flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 bg-paper px-4 py-3 text-base",
                    checked ? "border-brand bg-brand-soft" : "border-line",
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-6 shrink-0 accent-brand"
                    checked={checked}
                    onChange={(e) =>
                      update({
                        selectedActions: e.target.checked
                          ? [...draft.selectedActions, a]
                          : draft.selectedActions.filter((x) => x !== a),
                      })
                    }
                  />
                  {REFLECTION_ACTION_LABELS[a]}
                </label>
              );
            })}
          </div>
          <Button disabled={draft.selectedActions.length === 0} onClick={() => go(2)}>
            SIGUIENTE
          </Button>
          {back}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <h1 className="text-2xl font-bold leading-snug">¿Cuál sentís que fue tu aporte más importante?</h1>
          <TextArea
            aria-label="Tu aporte más importante (opcional)"
            placeholder="Contalo en una frase (opcional)"
            maxLength={500}
            value={draft.text}
            onChange={(e) => update({ text: e.target.value })}
            className="min-h-24"
          />
          <div>
            <p className="font-semibold">¿A qué se parece más?</p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de aporte">
              {PRIMARY_CONTRIBUTION_OPTIONS.map((o) => {
                const selected = draft.primaryCapability === o.capability;
                return (
                  <button
                    key={o.capability}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => update({ primaryCapability: o.capability })}
                    className={cn(
                      "min-h-14 rounded-2xl border-2 px-4 py-3 text-left text-base font-semibold",
                      selected ? "border-brand bg-brand text-white" : "border-line bg-paper",
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
          <Button disabled={!draft.primaryCapability} onClick={() => go(3)}>
            SIGUIENTE
          </Button>
          {back}
        </>
      ) : null}

      {step === 3 ? (
        <>
          <h1 className="text-2xl font-bold leading-snug">¿Sentís que tu aporte ayudó al equipo?</h1>
          <Scale
            name="Tu aporte ayudó al equipo"
            value={draft.perceivedValue}
            minLabel="Nada"
            maxLabel="Mucho"
            disabled={advancing}
            onChange={(v) => chooseAndAdvance({ perceivedValue: v }, 4)}
          />
          {back}
        </>
      ) : null}

      {step === 4 ? (
        <>
          <h1 className="text-2xl font-bold leading-snug">
            ¿La sugerencia que recibiste al comienzo te ayudó a encontrar una forma de participar?
          </h1>
          <Scale
            name="Utilidad de la sugerencia inicial"
            value={draft.initialModeUsefulness}
            minLabel="Nada"
            maxLabel="Mucho"
            onChange={(v) => update({ initialModeUsefulness: v })}
          />
          <ActionError error={error} needsReload={needsReload} />
          <Button
            disabled={draft.initialModeUsefulness == null}
            pending={pending}
            pendingLabel="Interpretando tu experiencia…"
            onClick={() => void submit()}
          >
            VER MI RESULTADO
          </Button>
          {back}
        </>
      ) : null}
    </div>
  );
}
