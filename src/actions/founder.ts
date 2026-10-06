"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { requireStaffAction } from "@/lib/auth/staff";
import { A3_BLOCKS, CAPABILITIES, MODES, OBSERVER_SOURCES } from "@/lib/domain/constants";
import { requireEvent } from "@/lib/services/events";
import { submitReflection } from "@/lib/services/reflection";
import { ReflectionSchema, type ReflectionFormInput } from "@/lib/validation/reflection";
import {
  addObservation,
  deleteArtifact,
  deleteObservation,
  saveA3Blocks,
  saveFounderAssessment,
} from "@/lib/services/founder";
import { runAction, type ActionResult } from "./result";

const id = z.uuid();
const score = z.number().int().min(1).max(5).nullable();

async function founderOp<T>(eventId: string, fn: (staffId: string) => Promise<T>): Promise<ActionResult<T>> {
  return runAction(async () => {
    const staff = await requireStaffAction();
    id.parse(eventId);
    const result = await fn(staff.id);
    revalidatePath(`/staff/events/${eventId}`, "layout");
    return result;
  });
}

const AssessmentSchema = z.object({
  problemScore: score,
  valueScore: score,
  testScore: score,
  feedback: z.string().max(1000, "El feedback puede tener hasta 1000 caracteres.").nullable(),
  winner: z.boolean(),
});

export async function saveAssessmentAction(
  eventId: string,
  teamId: string,
  input: z.input<typeof AssessmentSchema>,
  expectedUpdatedAt: string | null,
) {
  return founderOp(eventId, async (staffId) => {
    const data = AssessmentSchema.parse(input);
    await saveFounderAssessment(
      getDb(),
      eventId,
      id.parse(teamId),
      { ...data, feedback: data.feedback?.trim() || null },
      staffId,
      { expectedUpdatedAt: z.string().max(40).nullable().parse(expectedUpdatedAt) },
    );
    return null;
  });
}

const blocksSchema = z.array(z.enum(A3_BLOCKS));

export async function saveA3BlocksAction(eventId: string, teamId: string, blocks: string[], expectedBlocks: string[]) {
  return founderOp(eventId, async () => {
    await saveA3Blocks(getDb(), eventId, id.parse(teamId), blocksSchema.parse(blocks), {
      expectedBlocks: blocksSchema.parse(expectedBlocks),
    });
    return null;
  });
}

const ObservationSchema = z.object({
  participationId: z.uuid("Elegí a la persona."),
  capability: z.enum(CAPABILITIES),
  observerSource: z.enum(OBSERVER_SOURCES),
  note: z.string().max(500, "La nota puede tener hasta 500 caracteres.").nullable(),
});

export async function addObservationAction(
  eventId: string,
  teamId: string,
  input: z.input<typeof ObservationSchema>,
) {
  return founderOp(eventId, async (staffId) => {
    const data = ObservationSchema.parse(input);
    await addObservation(getDb(), eventId, id.parse(teamId), { ...data, note: data.note?.trim() || null }, staffId);
    return null;
  });
}

export async function deleteObservationAction(eventId: string, observationId: string) {
  return founderOp(eventId, async () => {
    await deleteObservation(getDb(), eventId, id.parse(observationId));
    return null;
  });
}

export async function deleteArtifactAction(eventId: string, artifactId: string) {
  return founderOp(eventId, async () => {
    await deleteArtifact(getDb(), eventId, id.parse(artifactId));
    return null;
  });
}

/**
 * Reflexión hecha en papel (contingencia, 03 §13) o de alguien sin celular, cargada por el staff.
 * Usa el mismo servicio que el participante: misma evidencia, interpretación e idempotencia.
 */
export async function submitReflectionByStaffAction(
  eventId: string,
  participationId: string,
  input: ReflectionFormInput,
  /** Modo del cuestionario en papel, si la persona no tenía uno. Va aparte de ReflectionSchema,
   * que comparte el participante: desde el celular nadie puede fijar su propio modo. */
  initialMode?: string | null,
) {
  return founderOp(eventId, async () => {
    const data = ReflectionSchema.parse(input);
    const mode = z.enum(MODES).nullable().optional().parse(initialMode);
    const db = getDb();
    const event = await requireEvent(db, eventId);
    const result = await submitReflection(
      db,
      event,
      id.parse(participationId),
      { ...data, primaryContributionText: data.primaryContributionText?.trim() || null },
      new Date(),
      { initialMode: mode },
    );
    return { alreadySubmitted: result.alreadySubmitted };
  });
}
