"use server";

import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { readParticipantToken, setParticipantToken } from "@/lib/auth/participant-session";
import { CAPABILITIES, MODES, REFLECTION_ACTIONS } from "@/lib/domain/constants";
import { nextStep, stepPath } from "@/lib/domain/flow";
import { QUESTION_KEYS } from "@/lib/domain/questionnaire";
import { DomainError } from "@/lib/services/errors";
import { getEventBySlug } from "@/lib/services/events";
import { submitReflection } from "@/lib/services/reflection";
import {
  checkIn,
  finalizeAssessment,
  getParticipantState,
  getParticipationByToken,
  recoverParticipation,
  registerCommunityInterest,
  registerParticipant,
  saveAnswer,
  saveChallengeChoices,
  savePreClarity,
  saveTieBreak,
  startParticipation,
  type ParticipantState,
} from "@/lib/services/participation";
import { runAction, type ActionResult } from "./result";

const SESSION_LOST =
  "No encontramos tu sesión en este navegador. Empezá de nuevo o recuperá tu lugar con tu WhatsApp.";

async function loadEvent(eventSlug: string) {
  const event = await getEventBySlug(getDb(), eventSlug);
  if (!event) throw new DomainError("EVENT_NOT_FOUND", "No encontramos este Innovatón.");
  return event;
}

async function loadContext(eventSlug: string) {
  const event = await loadEvent(eventSlug);
  const token = await readParticipantToken(eventSlug);
  const participation = await getParticipationByToken(getDb(), event.id, token);
  if (!participation) throw new DomainError("SESSION_LOST", SESSION_LOST);
  return { event, participation };
}

const slug = z.string().min(1).max(80);
const mode = z.enum(MODES);
const scale = z.number().int().min(1).max(5);

/** Inicia (o retoma) la participación anónima y devuelve la siguiente pantalla. */
export async function startParticipationAction(eventSlug: string): Promise<ActionResult<{ next: string }>> {
  return runAction(async () => {
    slug.parse(eventSlug);
    const event = await loadEvent(eventSlug);
    const db = getDb();
    const existing = await getParticipationByToken(db, event.id, await readParticipantToken(eventSlug));
    if (existing) return { next: stepPath(eventSlug, nextStep(existing)) };
    const { participation, token } = await startParticipation(db, event);
    await setParticipantToken(eventSlug, token);
    return { next: stepPath(eventSlug, nextStep(participation)) };
  });
}

export async function savePreClarityAction(
  eventSlug: string,
  value: number,
): Promise<ActionResult<{ next: string }>> {
  return runAction(async () => {
    const v = scale.parse(value);
    const { participation } = await loadContext(eventSlug);
    await savePreClarity(getDb(), participation, v);
    return { next: stepPath(eventSlug, "assessment") };
  });
}

export async function saveAnswerAction(
  eventSlug: string,
  questionKey: string,
  selected: string,
): Promise<ActionResult> {
  return runAction(async () => {
    const key = z.enum(QUESTION_KEYS as [string, ...string[]]).parse(questionKey) as (typeof QUESTION_KEYS)[number];
    const m = mode.parse(selected);
    const { participation } = await loadContext(eventSlug);
    await saveAnswer(getDb(), participation, key, m);
    return null;
  });
}

const AnswersSchema = z.object({ Q1: mode, Q2: mode, Q3: mode, Q4: mode, Q5: mode });

export async function finalizeAssessmentAction(
  eventSlug: string,
  answers: Record<string, string>,
): Promise<ActionResult<{ kind: "RESOLVED"; next: string } | { kind: "TIE"; modes: string[] }>> {
  return runAction(async () => {
    const parsed = AnswersSchema.parse(answers);
    const { participation } = await loadContext(eventSlug);
    const outcome = await finalizeAssessment(getDb(), participation, parsed);
    if (outcome.kind === "TIE") return { kind: "TIE" as const, modes: outcome.modes };
    return { kind: "RESOLVED" as const, next: stepPath(eventSlug, "result") };
  });
}

export async function saveTieBreakAction(
  eventSlug: string,
  selected: string,
): Promise<ActionResult<{ next: string }>> {
  return runAction(async () => {
    const m = mode.parse(selected);
    const { participation } = await loadContext(eventSlug);
    await saveTieBreak(getDb(), participation, m);
    return { next: stepPath(eventSlug, "result") };
  });
}

const ChoicesSchema = z.object({
  firstChoiceId: z.uuid(),
  secondChoiceId: z.uuid().nullable(),
  secondChoiceAny: z.boolean(),
});

export async function saveChoicesAction(
  eventSlug: string,
  input: { firstChoiceId: string; secondChoiceId: string | null; secondChoiceAny: boolean },
): Promise<ActionResult<{ next: string }>> {
  return runAction(async () => {
    const data = ChoicesSchema.parse(input);
    const { event, participation } = await loadContext(eventSlug);
    await saveChallengeChoices(getDb(), event, participation, data);
    return { next: stepPath(eventSlug, "register") };
  });
}

const RegisterSchema = z.object({
  name: z.string().max(200),
  whatsapp: z.string().max(40),
  operationalConsent: z.boolean(),
  communityConsent: z.boolean(),
});

export async function registerAction(
  eventSlug: string,
  input: { name: string; whatsapp: string; operationalConsent: boolean; communityConsent: boolean },
): Promise<ActionResult<{ next: string }>> {
  return runAction(async () => {
    const data = RegisterSchema.parse(input);
    const { event, participation } = await loadContext(eventSlug);
    await registerParticipant(getDb(), event, participation, data);
    return { next: stepPath(eventSlug, "status") };
  });
}

export async function checkInAction(eventSlug: string): Promise<ActionResult<ParticipantState>> {
  return runAction(async () => {
    const { event, participation } = await loadContext(eventSlug);
    const db = getDb();
    const updated = await checkIn(db, event, participation);
    return getParticipantState(db, event, updated);
  });
}

export async function recoverAction(
  eventSlug: string,
  whatsapp: string,
): Promise<ActionResult<{ next: string }>> {
  return runAction(async () => {
    const value = z.string().max(40).parse(whatsapp);
    const event = await loadEvent(eventSlug);
    const { token, participation } = await recoverParticipation(getDb(), event, value);
    await setParticipantToken(eventSlug, token);
    return { next: stepPath(eventSlug, nextStep(participation)) };
  });
}

export async function communityCtaAction(eventSlug: string): Promise<ActionResult> {
  return runAction(async () => {
    const { participation } = await loadContext(eventSlug);
    await registerCommunityInterest(getDb(), participation);
    return null;
  });
}

const ReflectionSchema = z.object({
  postClarity: scale,
  selectedActions: z.array(z.enum(REFLECTION_ACTIONS)).min(1, "Marcá al menos una cosa que hiciste."),
  primaryContributionText: z.string().max(500, "El texto puede tener hasta 500 caracteres.").nullable(),
  primaryCapability: z.enum(CAPABILITIES),
  perceivedValue: scale,
  initialModeUsefulness: scale,
});

export async function submitReflectionAction(
  eventSlug: string,
  input: z.input<typeof ReflectionSchema>,
): Promise<ActionResult<{ next: string }>> {
  return runAction(async () => {
    const data = ReflectionSchema.parse(input);
    const { event, participation } = await loadContext(eventSlug);
    await submitReflection(getDb(), event, participation.id, {
      ...data,
      primaryContributionText: data.primaryContributionText?.trim() || null,
    });
    return { next: stepPath(eventSlug, "outcome") };
  });
}
