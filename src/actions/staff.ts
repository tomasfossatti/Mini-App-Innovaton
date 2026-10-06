"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { requireStaffAction } from "@/lib/auth/staff";
import { EVENT_PHASES, type StaffRole } from "@/lib/domain/constants";
import { requireEvent, setEventPhase } from "@/lib/services/events";
import { manualCheckIn, staffQuickAdd, undoCheckIn } from "@/lib/services/operations";
import {
  assignLatecomer,
  createTeam,
  createTeamWithMembers,
  deleteTeam,
  generateTeams,
  moveParticipant,
  publishTeams,
  setTableNumber,
} from "@/lib/services/teams";
import { runAction, type ActionResult } from "./result";

const id = z.uuid();

function revalidateEvent(eventId: string) {
  revalidatePath(`/staff/events/${eventId}`, "layout");
}

/**
 * Wrapper común: sesión + rol + validación de ids + revalidación de las pantallas del evento.
 * STAFF (founders, facilitación, check-in) solo hace check-in y alta rápida; el resto es ADMIN.
 */
async function staffOp<T>(eventId: string, fn: () => Promise<T>, role: StaffRole = "ADMIN"): Promise<ActionResult<T>> {
  return runAction(async () => {
    await requireStaffAction(role);
    id.parse(eventId);
    const result = await fn();
    revalidateEvent(eventId);
    return result;
  });
}

export async function setPhaseAction(eventId: string, phase: string) {
  return staffOp(eventId, async () => {
    await setEventPhase(getDb(), eventId, z.enum(EVENT_PHASES).parse(phase));
    return null;
  });
}

export async function manualCheckInAction(eventId: string, participationId: string) {
  return staffOp(eventId, () => manualCheckIn(getDb(), eventId, id.parse(participationId)), "STAFF");
}

export async function undoCheckInAction(eventId: string, participationId: string) {
  return staffOp(
    eventId,
    async () => {
      await undoCheckIn(getDb(), eventId, id.parse(participationId));
      return null;
    },
    "STAFF",
  );
}

const QuickAddSchema = z.object({
  name: z.string().max(200),
  whatsapp: z.string().max(40),
  firstChoiceId: z.uuid("Elegí la primera opción."),
  secondChoiceId: z.uuid().nullable(),
  secondChoiceAny: z.boolean(),
});

export async function quickAddAction(
  eventId: string,
  input: z.input<typeof QuickAddSchema>,
) {
  return staffOp(
    eventId,
    async () => {
      const db = getDb();
      const event = await requireEvent(db, eventId);
      return staffQuickAdd(db, event, QuickAddSchema.parse(input));
    },
    "STAFF",
  );
}

const version = z.string().max(64).optional();

export async function generateTeamsAction(eventId: string, expectedVersion?: string) {
  return staffOp(eventId, () =>
    generateTeams(getDb(), eventId, { expectedVersion: version.parse(expectedVersion) }),
  );
}

export async function publishTeamsAction(eventId: string, expectedVersion?: string) {
  return staffOp(eventId, () =>
    publishTeams(getDb(), eventId, new Date(), { expectedVersion: version.parse(expectedVersion) }),
  );
}

export async function moveParticipantAction(eventId: string, participationId: string, teamId: string | null) {
  return staffOp(eventId, async () => {
    await moveParticipant(getDb(), eventId, id.parse(participationId), teamId ? id.parse(teamId) : null);
    return null;
  });
}

export async function assignLatecomerAction(
  eventId: string,
  participationId: string,
  teamId: string,
  allowFifth: boolean,
) {
  return staffOp(eventId, async () => {
    await assignLatecomer(getDb(), eventId, id.parse(participationId), id.parse(teamId), {
      allowFifth: z.boolean().parse(allowFifth),
    });
    return null;
  });
}

export async function createTeamAction(eventId: string, challengeId: string) {
  return staffOp(eventId, async () => {
    const team = await createTeam(getDb(), eventId, id.parse(challengeId));
    return { id: team.id, teamNumber: team.teamNumber, tableNumber: team.tableNumber };
  });
}

export async function createTeamWithMembersAction(eventId: string, challengeId: string, participationIds: string[]) {
  return staffOp(eventId, async () => {
    const ids = z.array(id).min(1).parse(participationIds);
    const team = await createTeamWithMembers(getDb(), eventId, id.parse(challengeId), ids);
    return { id: team.id, teamNumber: team.teamNumber, tableNumber: team.tableNumber };
  });
}

export async function deleteTeamAction(eventId: string, teamId: string) {
  return staffOp(eventId, async () => {
    await deleteTeam(getDb(), eventId, id.parse(teamId));
    return null;
  });
}

export async function setTableNumberAction(eventId: string, teamId: string, tableNumber: number) {
  return staffOp(eventId, async () => {
    await setTableNumber(getDb(), eventId, id.parse(teamId), z.number().int().min(1).max(999).parse(tableNumber));
    return null;
  });
}
