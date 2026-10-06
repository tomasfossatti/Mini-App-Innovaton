"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkInAction } from "@/actions/participant";
import { standPhrase } from "@/lib/domain/copy";
import type { ParticipantState } from "@/lib/services/participation";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { ActionError } from "@/components/ui/ActionError";
import { useActionRunner } from "@/components/ui/useActionRunner";

export interface StatusEventInfo {
  checkinTime: string;
  closeTime: string;
  startTime: string;
  dateLabel: string;
  location: string;
  googleCalendarUrl: string;
  icsUrl: string;
}


/** Cada cuánto consultar según el estado (02 §11: 5–10 s solo mientras espera equipo). */
const FINISHED_PHASES = ["REFLECTION", "CLOSED"];

function pollInterval(s: ParticipantState): number | null {
  if (s.hasOutcome || s.canReflect) return null;
  // Sin equipo cuando la experiencia ya terminó: no hay nada más que esperar.
  if (!s.team && FINISHED_PHASES.includes(s.eventPhase)) return null;
  if (s.team) {
    return s.eventPhase === "REFLECTION" || s.eventPhase === "CLOSED" ? null : 15_000;
  }
  if (s.checkedIn) return 6_000;
  if (s.canSelfCheckIn) return 20_000;
  if (s.status === "REGISTERED" || s.status === "NO_SHOW") return 15_000;
  return null;
}

function usePolledState(eventSlug: string, initial: ParticipantState) {
  const [state, setState] = useState(initial);
  const [lastError, setLastError] = useState(false);
  const [sessionLost, setSessionLost] = useState(false);
  const failures = useRef(0);

  const refresh = useCallback(async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(`/api/participant/state?event=${encodeURIComponent(eventSlug)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (res.status === 401) {
        setSessionLost(true);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as ParticipantState;
      failures.current = 0;
      setLastError(false);
      setState((prev) => {
        if (!prev.team && next.team && typeof navigator.vibrate === "function") navigator.vibrate(200);
        return next;
      });
    } catch {
      failures.current += 1;
      setLastError(true);
    } finally {
      window.clearTimeout(timer);
    }
  }, [eventSlug]);

  const interval = pollInterval(state);
  useEffect(() => {
    if (interval === null || sessionLost) return;
    let timer: number | undefined;
    const schedule = () => {
      // Backoff ante errores de red: hasta 30 s.
      const wait = Math.min(interval * 2 ** Math.min(failures.current, 3), 30_000);
      timer = window.setTimeout(async () => {
        if (document.visibilityState === "visible") await refresh();
        schedule();
      }, wait);
    };
    schedule();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [interval, refresh, sessionLost]);

  return { state, setState, refresh, lastError, sessionLost };
}

export function StatusView({
  eventSlug,
  initialState,
  info,
  mission,
}: {
  eventSlug: string;
  initialState: ParticipantState;
  info: StatusEventInfo;
  mission: { label: string; text: string } | null;
}) {
  const { state, setState, refresh, lastError, sessionLost } = usePolledState(eventSlug, initialState);
  const checkin = useActionRunner();
  const [refreshing, setRefreshing] = useState(false);

  async function doCheckIn() {
    const res = await checkin.run(() => checkInAction(eventSlug));
    if (res?.ok) setState(res.data);
  }

  async function manualRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  if (sessionLost) {
    return (
      <Notice tone="warn" title="Se perdió la sesión en este navegador">
        <Link href={`/e/${eventSlug}/recover`} className="font-semibold underline">
          Recuperá tu lugar con un código del stand
        </Link>
      </Notice>
    );
  }

  const missionBlock = mission ? (
    <div className="rounded-2xl bg-accent-soft p-4">
      <p className="text-sm font-bold uppercase tracking-wide text-ink/70">Tu misión · {mission.label}</p>
      <p className="mt-1 text-base font-semibold">{mission.text}</p>
    </div>
  ) : null;

  const refreshLink = (
    <div className="flex items-center justify-between gap-3 text-sm text-muted">
      <span>{lastError ? "Sin señal estable. Reintentamos solos." : "Se actualiza solo."}</span>
      <button
        type="button"
        onClick={() => void manualRefresh()}
        disabled={refreshing}
        className="min-h-11 rounded-xl px-3 font-semibold text-brand underline underline-offset-4 disabled:opacity-60"
      >
        {refreshing ? "Actualizando…" : "Actualizar"}
      </button>
    </div>
  );

  // 1. Ya terminó: resultado final.
  if (state.hasOutcome) {
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-extrabold">¡Gracias por participar!</h1>
        <LinkButton href={`/e/${eventSlug}/outcome`}>VER MI RESULTADO</LinkButton>
      </div>
    );
  }

  // 2. Equipo publicado (PRD §17): startup / equipo / mesa, sin colores ni símbolos.
  if (state.team) {
    return (
      <div className="space-y-5">
        <p className="text-lg font-semibold text-muted">Tu equipo</p>
        <Card className="space-y-2 py-8 text-center">
          <p className="text-4xl font-extrabold uppercase tracking-tight">{state.team.startupName}</p>
          <p className="text-3xl font-bold">Equipo {state.team.teamNumber}</p>
          <p className="text-5xl font-extrabold">Mesa {state.team.tableNumber}</p>
        </Card>
        {state.canReflect ? (
          <LinkButton href={`/e/${eventSlug}/reflection`}>HACER LA REFLEXIÓN FINAL</LinkButton>
        ) : (
          <>
            <p className="text-base">
              Andá a la mesa {state.team.tableNumber}. Durante el sprint guardá el celular: el trabajo es con tu equipo
              y el A3.
            </p>
            {missionBlock}
            <p className="text-sm text-muted">Al terminar los pitches volvé a esta pantalla para la reflexión final.</p>
            {refreshLink}
          </>
        )}
      </div>
    );
  }

  // 3. Puede hacer check-in (PRD §15).
  if (state.canSelfCheckIn) {
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-extrabold">¿Ya estás en el stand?</h1>
        <p className="text-lg text-muted">
          Confirmá tu lugar entre las {info.checkinTime} y las {info.closeTime}. A las {info.startTime} empezamos.
        </p>
        <Button pending={checkin.pending} pendingLabel="Confirmando…" onClick={() => void doCheckIn()}>
          ESTOY ACÁ
        </Button>
        <ActionError error={checkin.error} needsReload={checkin.needsReload} />
        {missionBlock}
      </div>
    );
  }

  // 4. La experiencia terminó y esta persona no quedó en un equipo.
  if (!state.team && FINISHED_PHASES.includes(state.eventPhase)) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-extrabold">El Innovatón ya terminó</h1>
        <p className="text-lg">
          Si participaste en un equipo y no ves tu reflexión, acercate al stand de Espacio IDI y el staff lo resuelve.
        </p>
      </div>
    );
  }

  // 5. Presente, esperando equipo.
  if (state.checkedIn && (state.eventPhase === "CHECKIN" || state.eventPhase === "MATCHING")) {
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-extrabold">Listo. Estás adentro.</h1>
        <p className="text-lg">Estamos formando los equipos con las personas que ya llegaron.</p>
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-paper p-4 text-base font-medium" role="status">
          <Spinner className="text-brand" />
          Esperando la publicación de equipos…
        </div>
        {missionBlock}
        {refreshLink}
      </div>
    );
  }

  // 6. Presente sin equipo con los equipos ya publicados: lo resuelve el staff.
  if (state.checkedIn) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-extrabold">Estás adentro. Acercate al stand</h1>
        <p className="text-lg">Los equipos ya salieron: el staff te suma a uno. Esta pantalla se actualiza sola.</p>
        {missionBlock}
        {refreshLink}
      </div>
    );
  }

  // 7. Llegó tarde o no hizo check-in a tiempo.
  if (["MATCHING", "SPRINT", "PITCH", "REFLECTION", "CLOSED"].includes(state.eventPhase)) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-extrabold">Acercate al stand de Espacio IDI</h1>
        <p className="text-lg">
          Los equipos se arman con las personas presentes. Si estás en el stand, avisale al staff y te suma si es
          posible.
        </p>
        {refreshLink}
      </div>
    );
  }

  // 8. Preinscripto (PRD §13).
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-extrabold">Estás preinscripto.</h1>
      <div className="space-y-1 text-lg">
        <p>
          Volvé al {standPhrase(info.location)} entre {info.checkinTime} y {info.closeTime}.
        </p>
        <p className="font-semibold">A las {info.startTime} empezamos.</p>
        <p className="text-base text-muted">{info.dateLabel}</p>
      </div>
      <div className="space-y-3">
        <a href={info.googleCalendarUrl} target="_blank" rel="noopener noreferrer" className="block">
          <span className="inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-brand px-6 text-lg font-semibold text-white">
            AGREGAR AL CALENDARIO
          </span>
        </a>
        <a
          href={info.icsUrl}
          className="block min-h-11 content-center text-center font-semibold text-brand underline underline-offset-4"
        >
          Descargar evento (.ics) para iPhone u otro calendario
        </a>
      </div>
      {state.firstChoice ? (
        <p className="text-base text-muted">
          Elegiste <strong className="text-ink">{state.firstChoice.startupName}</strong>
          {state.secondChoiceAny
            ? " y cualquier otro desafío como segunda opción."
            : state.secondChoice
              ? ` y, como segunda opción, ${state.secondChoice.startupName}.`
              : "."}
        </p>
      ) : null}
      {missionBlock}
      <p className="text-sm text-muted">Te vamos a escribir por WhatsApp unos minutos antes. Podés cerrar esta pantalla.</p>
    </div>
  );
}
