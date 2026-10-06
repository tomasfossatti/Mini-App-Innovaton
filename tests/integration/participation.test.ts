import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import type { EventPhase, Mode } from "@/lib/domain/constants";
import type { QuestionKey } from "@/lib/domain/questionnaire";
import {
  checkIn,
  finalizeAssessment,
  getParticipantState,
  getParticipationByToken,
  RECOVERY_MAX_ATTEMPTS,
  recoverParticipation,
  registerCommunityInterest,
  registerParticipant,
  saveAnswer,
  saveChallengeChoices,
  savePreClarity,
  saveTieBreak,
  startParticipation,
} from "@/lib/services/participation";
import { DomainError } from "@/lib/services/errors";
import { createRecoveryCode } from "@/lib/services/operations";
import { closeTestDb, makeChallenges, makeEvent, resetDb, testDb } from "./helpers";

const db = testDb();

const ALL: Record<QuestionKey, Mode> = { Q1: "EXPLORE", Q2: "EXPLORE", Q3: "CREATE", Q4: "EXPLORE", Q5: "DRIVE" };
const TIE: Record<QuestionKey, Mode> = { Q1: "EXPLORE", Q2: "CREATE", Q3: "EXPLORE", Q4: "CREATE", Q5: "DRIVE" };

async function setup(phase: EventPhase = "REGISTRATION") {
  const event = await makeEvent(db, { phase });
  const challenges = await makeChallenges(db, event.id, 3);
  return { event, challenges };
}

async function reload(id: string) {
  const row = await db.query.participations.findFirst({ where: eq(s.participations.id, id) });
  if (!row) throw new Error("missing");
  return row;
}

/** Recorre el flujo hasta dejar lista la inscripción. */
async function readyToRegister(event: s.EventRow, firstId: string, secondId: string | null) {
  const { participation, token } = await startParticipation(db, event);
  await savePreClarity(db, participation, 2);
  await finalizeAssessment(db, await reload(participation.id), ALL);
  await saveChallengeChoices(db, event, await reload(participation.id), {
    firstChoiceId: firstId,
    secondChoiceId: secondId,
    secondChoiceAny: secondId === null,
  });
  return { id: participation.id, token };
}

async function setPhase(eventId: string, phase: EventPhase) {
  const [e] = await db.update(s.events).set({ phase }).where(eq(s.events.id, eventId)).returning();
  return e;
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await closeTestDb();
});

describe("flujo del participante", () => {
  it("completa el recorrido y queda REGISTERED sin evidencia", async () => {
    const { event, challenges } = await setup();
    const { id, token } = await readyToRegister(event, challenges[0].id, challenges[1].id);
    expect(await getParticipationByToken(db, event.id, token)).toMatchObject({ id });
    const p = await reload(id);
    expect(p.initialMode).toBe("EXPLORE");
    expect(p.status).toBe("PROFILE_COMPLETED");
    expect([p.exploreScore, p.createScore, p.driveScore]).toEqual([3, 1, 1]);

    const res = await registerParticipant(db, event, p, {
      name: "  Ana   Pérez ",
      whatsapp: "0351 15 123 4567",
      operationalConsent: true,
      communityConsent: false,
    });
    expect(res.participation.status).toBe("REGISTERED");
    expect(res.participation.checkedInAt).toBeNull();
    expect(res.participation.communityConsentAt).toBeNull();
    const person = await db.query.participants.findFirst();
    expect(person?.name).toBe("Ana Pérez");
    expect(person?.whatsappNormalized).toBe("+5493511234567");
    // El cuestionario nunca genera evidencia.
    expect(await db.select().from(s.evidenceItems)).toHaveLength(0);
  });

  it("desempate 2–2–1: solo acepta uno de los dos empatados", async () => {
    const { event } = await setup();
    const { participation } = await startParticipation(db, event);
    await savePreClarity(db, participation, 3);
    const out = await finalizeAssessment(db, await reload(participation.id), TIE);
    expect(out).toEqual({ kind: "TIE", modes: ["EXPLORE", "CREATE"] });
    expect((await reload(participation.id)).initialMode).toBeNull();
    await expect(saveTieBreak(db, await reload(participation.id), "DRIVE")).rejects.toBeInstanceOf(DomainError);
    await saveTieBreak(db, await reload(participation.id), "CREATE");
    const p = await reload(participation.id);
    expect(p.initialMode).toBe("CREATE");
    expect(p.status).toBe("PROFILE_COMPLETED");
    // Doble tap del desempate no falla.
    await saveTieBreak(db, p, "CREATE");
    // Re-finalizar con el mismo empate respeta la elección.
    expect(await finalizeAssessment(db, await reload(participation.id), TIE)).toEqual({
      kind: "RESOLVED",
      mode: "CREATE",
    });
  });

  it("cambiar una respuesta ya dada invalida la hipótesis hasta volver a finalizar", async () => {
    const { event } = await setup();
    const { participation } = await startParticipation(db, event);
    await savePreClarity(db, participation, 3);
    await finalizeAssessment(db, await reload(participation.id), ALL);
    await saveAnswer(db, await reload(participation.id), "Q1", "DRIVE");
    const p = await reload(participation.id);
    expect(p.initialMode).toBeNull();
    expect(p.status).toBe("STARTED");
  });

  it("valida las elecciones de desafío", async () => {
    const { event, challenges } = await setup();
    const other = await makeEvent(db);
    const [foreign] = await makeChallenges(db, other.id, 1);
    const { participation } = await startParticipation(db, event);
    await savePreClarity(db, participation, 3);
    await finalizeAssessment(db, await reload(participation.id), ALL);
    const p = await reload(participation.id);
    const attempt = (first: string, second: string | null, any: boolean) =>
      saveChallengeChoices(db, event, p, { firstChoiceId: first, secondChoiceId: second, secondChoiceAny: any });
    await expect(attempt(challenges[0].id, challenges[0].id, false)).rejects.toThrow(/distinta/);
    await expect(attempt(challenges[0].id, null, false)).rejects.toThrow(/segunda opción/);
    await expect(attempt(challenges[0].id, challenges[1].id, true)).rejects.toThrow();
    await expect(attempt(foreign.id, challenges[1].id, false)).rejects.toThrow(/disponible/);
    await db.update(s.challenges).set({ active: false }).where(eq(s.challenges.id, challenges[2].id));
    await expect(attempt(challenges[2].id, challenges[1].id, false)).rejects.toThrow(/disponible/);
    await attempt(challenges[0].id, null, true);
    expect((await reload(p.id)).secondChoiceAny).toBe(true);
  });

  it("exige consentimiento operativo y WhatsApp válido", async () => {
    const { event, challenges } = await setup();
    const { id } = await readyToRegister(event, challenges[0].id, null);
    const p = await reload(id);
    await expect(
      registerParticipant(db, event, p, { name: "Ana", whatsapp: "351 1234567", operationalConsent: false, communityConsent: true }),
    ).rejects.toThrow(/WhatsApp/);
    await expect(
      registerParticipant(db, event, p, { name: "Ana", whatsapp: "123", operationalConsent: true, communityConsent: true }),
    ).rejects.toThrow(/número/);
  });

  it("doble submit de inscripción es idempotente", async () => {
    const { event, challenges } = await setup();
    const { id } = await readyToRegister(event, challenges[0].id, challenges[1].id);
    const p = await reload(id);
    const input = { name: "Ana", whatsapp: "3511234567", operationalConsent: true, communityConsent: true };
    const [a, b] = await Promise.all([
      registerParticipant(db, event, p, input),
      registerParticipant(db, event, p, input),
    ]);
    expect(a.participation.id).toBe(id);
    expect(b.participation.id).toBe(id);
    expect(await db.select().from(s.participants)).toHaveLength(1);
    expect(await db.select().from(s.participations)).toHaveLength(1);
  });

  it("inscripción en fase CHECKIN queda presente automáticamente", async () => {
    const { event, challenges } = await setup("CHECKIN");
    const { id } = await readyToRegister(event, challenges[0].id, challenges[1].id);
    const res = await registerParticipant(db, event, await reload(id), {
      name: "Beto",
      whatsapp: "+54 9 351 765 4321",
      operationalConsent: true,
      communityConsent: true,
    });
    expect(res.participation.status).toBe("CHECKED_IN");
    expect(res.participation.checkedInAt).not.toBeNull();
    expect(res.participation.communityConsentAt).not.toBeNull();
  });

  it("WhatsApp ya inscripto en el evento: rechaza sin tocar la inscripción existente", async () => {
    const { event, challenges } = await setup();
    const first = await readyToRegister(event, challenges[0].id, challenges[1].id);
    await registerParticipant(db, event, await reload(first.id), {
      name: "Caro",
      whatsapp: "351 15 222 3333",
      operationalConsent: true,
      communityConsent: true,
    });
    const ev = await setPhase(event.id, "CHECKIN");
    await checkIn(db, ev, await reload(first.id));
    const before = await reload(first.id);

    // Otro dispositivo (o alguien que conoce el número) intenta inscribirse con el mismo WhatsApp.
    const second = await readyToRegister(ev, challenges[2].id, null);
    await expect(
      registerParticipant(db, ev, await reload(second.id), {
        name: "Otra Persona",
        whatsapp: "+5493512223333",
        operationalConsent: true,
        communityConsent: false,
      }),
    ).rejects.toMatchObject({ code: "ALREADY_REGISTERED" });

    const after = await reload(first.id);
    expect(after).toMatchObject({
      status: "CHECKED_IN",
      firstChoiceId: before.firstChoiceId,
      secondChoiceId: before.secondChoiceId,
      resumeTokenHash: before.resumeTokenHash,
    });
    expect(after.communityConsentAt).not.toBeNull();
    expect((await db.query.participants.findFirst())?.name).toBe("Caro");
    expect((await reload(second.id)).status).toBe("PROFILE_COMPLETED");
    // La salida legítima es recuperar el lugar con el código que da el staff en el stand.
    const { code } = await createRecoveryCode(db, ev.id, first.id);
    const rec = await recoverParticipation(db, ev, "351 15 222 3333", code);
    expect(rec.participation.id).toBe(first.id);
  });

  it("la misma persona en otro evento reutiliza su identidad", async () => {
    const { event, challenges } = await setup();
    const a = await readyToRegister(event, challenges[0].id, null);
    await registerParticipant(db, event, await reload(a.id), {
      name: "Dani",
      whatsapp: "351 444 1111",
      operationalConsent: true,
      communityConsent: false,
    });
    const other = await makeEvent(db);
    const otherChallenges = await makeChallenges(db, other.id, 2);
    const b = await readyToRegister(other, otherChallenges[0].id, otherChallenges[1].id);
    const res = await registerParticipant(db, other, await reload(b.id), {
      name: "Daniela",
      whatsapp: "+5493514441111",
      operationalConsent: true,
      communityConsent: false,
    });
    expect(res.participation.status).toBe("REGISTERED");
    expect(await db.select().from(s.participants)).toHaveLength(1);
  });

  it("inscripción cerrada y llegada tarde", async () => {
    const { event, challenges } = await setup();
    const { id } = await readyToRegister(event, challenges[0].id, challenges[1].id);
    const pitch = await setPhase(event.id, "PITCH");
    await expect(startParticipation(db, pitch)).rejects.toThrow(/cerró/);
    const matching = await setPhase(event.id, "MATCHING");
    const res = await registerParticipant(db, matching, await reload(id), {
      name: "Dani",
      whatsapp: "3517778888",
      operationalConsent: true,
      communityConsent: false,
    });
    expect(res.late).toBe(true);
    expect(res.participation.status).toBe("REGISTERED");
  });
});

describe("check-in", () => {
  it("antes de abrir avisa la hora; es idempotente; después del sprint deriva al stand", async () => {
    const { event, challenges } = await setup();
    const { id } = await readyToRegister(event, challenges[0].id, challenges[1].id);
    await registerParticipant(db, event, await reload(id), {
      name: "Eli",
      whatsapp: "3514445555",
      operationalConsent: true,
      communityConsent: false,
    });
    await expect(checkIn(db, event, await reload(id))).rejects.toThrow(/14:20/);
    const open = await setPhase(event.id, "CHECKIN");
    const p = await reload(id);
    const [a, b] = await Promise.all([checkIn(db, open, p), checkIn(db, open, p)]);
    expect(a.status).toBe("CHECKED_IN");
    expect(b.status).toBe("CHECKED_IN");
    const again = await checkIn(db, open, await reload(id));
    expect(again.checkedInAt?.getTime()).toBe(a.checkedInAt?.getTime());

    const { id: id2 } = await readyToRegister(open, challenges[0].id, null);
    // registrado en CHECKIN → ya presente; creamos otro inscripto en REGISTRATION para probar SPRINT
    expect((await reload(id2)).status).toBe("PROFILE_COMPLETED");
    const sprint = await setPhase(event.id, "SPRINT");
    await registerParticipant(db, sprint, await reload(id2), {
      name: "Fede",
      whatsapp: "3519990000",
      operationalConsent: true,
      communityConsent: false,
    });
    await expect(checkIn(db, sprint, await reload(id2))).rejects.toThrow(/stand/);
  });
});

describe("recuperación de sesión y estado", () => {
  async function registered(name: string, whatsapp: string) {
    const { event, challenges } = await setup();
    const { id, token } = await readyToRegister(event, challenges[0].id, challenges[1].id);
    await registerParticipant(db, event, await reload(id), {
      name,
      whatsapp,
      operationalConsent: true,
      communityConsent: false,
    });
    return { event, challenges, id, token };
  }

  it("el WhatsApp solo no alcanza: hace falta el código del staff", async () => {
    const { event, id, token } = await registered("Gabi", "351 15 444 5555");
    await expect(recoverParticipation(db, event, "+54 9 351 444-5555", "123456")).rejects.toMatchObject({
      code: "RECOVERY_FAILED",
    });
    expect(await getParticipationByToken(db, event.id, token)).not.toBeNull();
    expect((await reload(id)).recoveryAttempts).toBe(0); // sin código activo no hay nada que probar
  });

  it("con el código del staff recupera aunque el número esté escrito distinto, rota el token y el código es de un solo uso", async () => {
    const { event, id, token } = await registered("Gabi", "351 15 444 5555");
    const { code, expiresAt } = await createRecoveryCode(db, event.id, id);
    expect(code).toMatch(/^\d{6}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    const rec = await recoverParticipation(db, event, "+54 9 351 444-5555", ` ${code.slice(0, 3)} ${code.slice(3)} `);
    expect(rec.participation.id).toBe(id);
    expect((await getParticipationByToken(db, event.id, rec.token))?.id).toBe(id);
    expect(await getParticipationByToken(db, event.id, token)).toBeNull();
    const after = await reload(id);
    expect(after.recoveryCodeHash).toBeNull();
    expect(after.recoveryCodeExpiresAt).toBeNull();
    // El mismo código no sirve una segunda vez (por ejemplo, desde otro celular).
    await expect(recoverParticipation(db, event, "3514445555", code)).rejects.toMatchObject({
      code: "RECOVERY_FAILED",
    });
  });

  it("se invalida tras 5 intentos fallidos y cada intento queda contado", async () => {
    const { event, id } = await registered("Ivo", "3516667777");
    const { code } = await createRecoveryCode(db, event.id, id);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 1; i <= RECOVERY_MAX_ATTEMPTS; i++) {
      await expect(recoverParticipation(db, event, "3516667777", wrong)).rejects.toMatchObject({
        code: "RECOVERY_FAILED",
      });
      expect((await reload(id)).recoveryAttempts).toBe(i);
    }
    expect((await reload(id)).recoveryCodeHash).toBeNull();
    // Ni siquiera el código correcto sirve ya: el staff tiene que generar otro.
    await expect(recoverParticipation(db, event, "3516667777", code)).rejects.toMatchObject({
      code: "RECOVERY_FAILED",
    });
    const fresh = await createRecoveryCode(db, event.id, id);
    expect((await reload(id)).recoveryAttempts).toBe(0);
    const rec = await recoverParticipation(db, event, "3516667777", fresh.code);
    expect(rec.participation.id).toBe(id);
  });

  it("un código vencido o reemplazado no sirve", async () => {
    const { event, id } = await registered("Juli", "3518889999");
    const old = await createRecoveryCode(db, event.id, id, new Date(Date.now() - 16 * 60_000));
    await expect(recoverParticipation(db, event, "3518889999", old.code)).rejects.toMatchObject({
      code: "RECOVERY_FAILED",
    });
    const first = await createRecoveryCode(db, event.id, id);
    const second = await createRecoveryCode(db, event.id, id);
    if (first.code !== second.code) {
      await expect(recoverParticipation(db, event, "3518889999", first.code)).rejects.toMatchObject({
        code: "RECOVERY_FAILED",
      });
    }
    const rec = await recoverParticipation(db, event, "3518889999", second.code);
    expect(rec.participation.id).toBe(id);
  });

  it("número desconocido, código mal formado e inscripción incompleta", async () => {
    const { event, challenges, id } = await registered("Kim", "3511112222");
    const { code } = await createRecoveryCode(db, event.id, id);
    // Mismo mensaje para un número que no está inscripto: no revela quién se inscribió.
    const unknown = await recoverParticipation(db, event, "351 999 9999", code).catch((e: DomainError) => e);
    const wrong = await recoverParticipation(db, event, "3511112222", code === "000000" ? "111111" : "000000").catch(
      (e: DomainError) => e,
    );
    expect(unknown).toMatchObject({ code: "RECOVERY_FAILED" });
    expect((unknown as DomainError).message).toBe((wrong as DomainError).message);
    await expect(recoverParticipation(db, event, "3511112222", "12a")).rejects.toMatchObject({ code: "INVALID_CODE" });
    expect((await reload(id)).recoveryAttempts).toBe(1); // el código mal formado no gasta intentos

    const incomplete = await readyToRegister(event, challenges[0].id, null);
    await expect(createRecoveryCode(db, event.id, incomplete.id)).rejects.toMatchObject({ code: "NOT_REGISTERED" });
    const other = await makeEvent(db);
    await expect(createRecoveryCode(db, other.id, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("el estado nunca muestra equipos borrador", async () => {
    const { event, challenges } = await setup("MATCHING");
    const { id } = await readyToRegister(event, challenges[0].id, challenges[1].id);
    await registerParticipant(db, event, await reload(id), {
      name: "Hugo",
      whatsapp: "3512223344",
      operationalConsent: true,
      communityConsent: false,
    });
    const [team] = await db
      .insert(s.teams)
      .values({ eventId: event.id, challengeId: challenges[0].id, teamNumber: 1, tableNumber: 4 })
      .returning();
    await db.update(s.participations).set({ teamId: team.id, status: "CHECKED_IN" }).where(eq(s.participations.id, id));
    let state = await getParticipantState(db, event, await reload(id));
    expect(state.team).toBeNull();
    expect(state.firstChoice?.startupName).toBe(challenges[0].startupName);
    await db.update(s.teams).set({ publishedAt: new Date() }).where(eq(s.teams.id, team.id));
    await db.update(s.participations).set({ status: "MATCHED" }).where(eq(s.participations.id, id));
    state = await getParticipantState(db, event, await reload(id));
    expect(state.team).toMatchObject({ teamNumber: 1, tableNumber: 4, published: true });
    expect(state.canReflect).toBe(false);
    const refl = await setPhase(event.id, "REFLECTION");
    state = await getParticipantState(db, refl, await reload(id));
    expect(state.canReflect).toBe(true);
  });

  it("CTA de comunidad idempotente", async () => {
    const { event, challenges } = await setup();
    const { id } = await readyToRegister(event, challenges[0].id, challenges[1].id);
    await registerParticipant(db, event, await reload(id), {
      name: "Ivo",
      whatsapp: "3516667777",
      operationalConsent: true,
      communityConsent: false,
    });
    await registerCommunityInterest(db, await reload(id));
    const first = await reload(id);
    expect(first.communityCtaAt).not.toBeNull();
    expect(first.communityConsentAt).not.toBeNull();
    await registerCommunityInterest(db, first);
    expect((await reload(id)).communityCtaAt?.getTime()).toBe(first.communityCtaAt?.getTime());
  });
});
