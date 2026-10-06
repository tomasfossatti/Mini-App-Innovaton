"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { requireStaffAction } from "@/lib/auth/staff";
import { STAFF_ROLES } from "@/lib/domain/constants";
import { zonedDateTimeToUtc } from "@/lib/domain/time";
import {
  createChallenge,
  createEvent,
  deleteChallenge,
  updateChallenge,
  updateEvent,
  type ChallengeInput,
  type EventInput,
} from "@/lib/services/events";
import { createStaffMember, resetStaffPassword, setStaffActive } from "@/lib/services/staff";
import { runAction, type ActionResult } from "./result";

const time = z.string().regex(/^\d{2}:\d{2}$/, "Usá el formato HH:MM.");
const id = z.uuid("Identificador inválido.");

const EventFormSchema = z.object({
  name: z.string().trim().min(3, "Poné un nombre al evento.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "El identificador necesita al menos 3 caracteres.")
    .max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elegí la fecha del evento."),
  timezone: z.string().trim().min(3).max(60),
  locationLabel: z.string().trim().min(2).max(120),
  registrationOpens: time,
  checkinOpens: time,
  registrationCloses: time,
  starts: time,
  ends: time,
  communityUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https?:\/\//.test(v), "El link de comunidad tiene que empezar con http(s)://"),
});

function parseEventForm(formData: FormData): EventInput {
  const data = EventFormSchema.parse(Object.fromEntries(formData));
  const at = (t: string) => zonedDateTimeToUtc(data.date, t, data.timezone);
  return {
    name: data.name,
    slug: data.slug,
    timezone: data.timezone,
    locationLabel: data.locationLabel,
    registrationOpensAt: at(data.registrationOpens),
    checkinOpensAt: at(data.checkinOpens),
    registrationClosesAt: at(data.registrationCloses),
    startsAt: at(data.starts),
    endsAt: at(data.ends),
    communityUrl: data.communityUrl || null,
  };
}

export async function createEventAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(async () => {
    await requireStaffAction("ADMIN");
    const event = await createEvent(getDb(), parseEventForm(formData));
    return { id: event.id };
  });
  if (result.ok) {
    revalidatePath("/staff");
    redirect(`/staff/events/${result.data.id}/settings`);
  }
  return result;
}

export async function updateEventAction(
  eventId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    await requireStaffAction("ADMIN");
    await updateEvent(getDb(), id.parse(eventId), parseEventForm(formData));
    revalidatePath(`/staff/events/${eventId}`, "layout");
    return null;
  });
}

const ChallengeFormSchema = z.object({
  startupName: z.string().trim().min(2, "Falta el nombre de la startup.").max(120),
  title: z.string().trim().min(5, "Falta el desafío.").max(400),
  description: z.string().trim().min(5, "Falta la descripción breve.").max(600),
  brief: z.string().trim().max(8000).default(""),
  prize: z.string().trim().max(300).default(""),
  sortOrder: z.coerce.number().int().min(0).max(999),
  active: z.string().optional(),
});

function parseChallengeForm(formData: FormData): ChallengeInput {
  const data = ChallengeFormSchema.parse(Object.fromEntries(formData));
  return {
    startupName: data.startupName,
    title: data.title,
    description: data.description,
    brief: data.brief,
    prize: data.prize || null,
    sortOrder: data.sortOrder,
    active: data.active === "on" || data.active === "true",
  };
}

export async function createChallengeAction(
  eventId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    await requireStaffAction("ADMIN");
    await createChallenge(getDb(), id.parse(eventId), parseChallengeForm(formData));
    revalidatePath(`/staff/events/${eventId}`, "layout");
    return null;
  });
}

export async function updateChallengeAction(
  eventId: string,
  challengeId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    await requireStaffAction("ADMIN");
    await updateChallenge(getDb(), id.parse(eventId), id.parse(challengeId), parseChallengeForm(formData));
    revalidatePath(`/staff/events/${eventId}`, "layout");
    return null;
  });
}

export async function deleteChallengeAction(
  eventId: string,
  challengeId: string,
): Promise<ActionResult> {
  return runAction(async () => {
    await requireStaffAction("ADMIN");
    await deleteChallenge(getDb(), id.parse(eventId), id.parse(challengeId));
    revalidatePath(`/staff/events/${eventId}`, "layout");
    return null;
  });
}

const StaffFormSchema = z.object({
  email: z.string().trim().email("Revisá el email."),
  name: z.string().trim().min(2, "Falta el nombre.").max(120),
  password: z.string().min(8, "La contraseña necesita al menos 8 caracteres.").max(200),
  role: z.enum(STAFF_ROLES),
});

export async function createStaffAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    await requireStaffAction("ADMIN");
    const data = StaffFormSchema.parse(Object.fromEntries(formData));
    await createStaffMember(getDb(), data);
    revalidatePath("/staff/members");
    return null;
  });
}

export async function setStaffActiveAction(staffId: string, active: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireStaffAction("ADMIN");
    await setStaffActive(getDb(), actor.id, id.parse(staffId), z.boolean().parse(active));
    revalidatePath("/staff/members");
    return null;
  });
}

export async function resetStaffPasswordAction(
  staffId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    await requireStaffAction("ADMIN");
    const password = z
      .string()
      .min(8, "La contraseña necesita al menos 8 caracteres.")
      .parse(formData.get("password"));
    await resetStaffPassword(getDb(), id.parse(staffId), password);
    revalidatePath("/staff/members");
    return null;
  });
}
