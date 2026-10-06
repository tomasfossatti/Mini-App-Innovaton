import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  LOCK_MINUTES,
  MAX_FAILED_LOGINS,
  authenticateStaff,
  createStaffMember,
  createStaffSession,
  deleteStaffSession,
  getStaffBySessionToken,
  resetStaffPassword,
  setStaffActive,
} from "@/lib/services/staff";
import { closeTestDb, resetDb, testDb } from "./helpers";

const db = testDb();
const PASS = "clave-segura-123";

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await closeTestDb();
});

describe("auth de staff", () => {
  it("login correcto, email sin importar mayúsculas", async () => {
    await createStaffMember(db, { email: "Ana@Example.com", name: "Ana", password: PASS, role: "ADMIN" });
    const res = await authenticateStaff(db, "  ana@example.COM ", PASS);
    expect(res).toMatchObject({ ok: true, staff: { email: "ana@example.com", role: "ADMIN" } });
    expect(await authenticateStaff(db, "ana@example.com", "otra-clave")).toEqual({ ok: false, reason: "INVALID" });
    expect(await authenticateStaff(db, "nadie@example.com", PASS)).toEqual({ ok: false, reason: "INVALID" });
  });

  it(`bloquea ${LOCK_MINUTES} min tras ${MAX_FAILED_LOGINS} fallos y se desbloquea solo`, async () => {
    await createStaffMember(db, { email: "b@example.com", name: "B", password: PASS, role: "STAFF" });
    const t0 = new Date("2026-10-15T17:00:00Z");
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
      expect(await authenticateStaff(db, "b@example.com", "mal", t0)).toEqual({ ok: false, reason: "INVALID" });
    }
    expect(await authenticateStaff(db, "b@example.com", "mal", t0)).toEqual({ ok: false, reason: "LOCKED" });
    // Con la clave correcta pero durante el bloqueo, sigue bloqueada.
    expect(await authenticateStaff(db, "b@example.com", PASS, new Date(t0.getTime() + 60_000))).toEqual({
      ok: false,
      reason: "LOCKED",
    });
    const later = new Date(t0.getTime() + (LOCK_MINUTES + 1) * 60_000);
    expect((await authenticateStaff(db, "b@example.com", PASS, later)).ok).toBe(true);
    // El contador se reinició: un fallo más no bloquea.
    expect(await authenticateStaff(db, "b@example.com", "mal", later)).toEqual({ ok: false, reason: "INVALID" });
  });

  it("cambiar la contraseña desbloquea la cuenta", async () => {
    const m = await createStaffMember(db, { email: "c@example.com", name: "C", password: PASS, role: "STAFF" });
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await authenticateStaff(db, "c@example.com", "mal");
    expect((await authenticateStaff(db, "c@example.com", PASS)).ok).toBe(false);
    await resetStaffPassword(db, m.id, "nueva-clave-456");
    expect((await authenticateStaff(db, "c@example.com", "nueva-clave-456")).ok).toBe(true);
  });

  it("cuenta inactiva no entra y pierde sus sesiones", async () => {
    const admin = await createStaffMember(db, { email: "a@example.com", name: "A", password: PASS, role: "ADMIN" });
    const m = await createStaffMember(db, { email: "d@example.com", name: "D", password: PASS, role: "STAFF" });
    const { token } = await createStaffSession(db, m.id);
    expect(await getStaffBySessionToken(db, token)).toMatchObject({ id: m.id });
    await setStaffActive(db, admin.id, m.id, false);
    expect(await getStaffBySessionToken(db, token)).toBeNull();
    expect(await authenticateStaff(db, "d@example.com", PASS)).toEqual({ ok: false, reason: "INVALID" });
    await expect(setStaffActive(db, admin.id, admin.id, false)).rejects.toThrow(/propia cuenta/);
  });

  it("sesiones: vencen y se pueden cerrar", async () => {
    const m = await createStaffMember(db, { email: "e@example.com", name: "E", password: PASS, role: "STAFF" });
    const t0 = new Date("2026-10-15T12:00:00Z");
    const { token, expiresAt } = await createStaffSession(db, m.id, t0);
    expect(await getStaffBySessionToken(db, token, t0)).not.toBeNull();
    expect(await getStaffBySessionToken(db, token, new Date(expiresAt.getTime() + 1000))).toBeNull();
    await deleteStaffSession(db, token);
    expect(await getStaffBySessionToken(db, token, t0)).toBeNull();
    expect(await getStaffBySessionToken(db, "token-inventado", t0)).toBeNull();
  });

  it("contraseña corta y email repetido se rechazan", async () => {
    await expect(createStaffMember(db, { email: "f@example.com", name: "F", password: "corta", role: "STAFF" })).rejects.toThrow(/8 caracteres/);
    await createStaffMember(db, { email: "f@example.com", name: "F", password: PASS, role: "STAFF" });
    await expect(createStaffMember(db, { email: "F@example.com", name: "F2", password: PASS, role: "STAFF" })).rejects.toThrow(/Ya existe/);
  });
});
