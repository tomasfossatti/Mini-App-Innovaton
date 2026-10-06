import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import { staffMembers, staffSessions, type StaffMemberRow } from "@/lib/db/schema";
import type { StaffRole } from "@/lib/domain/constants";
import { generateToken, hashPassword, sha256, verifyPassword } from "@/lib/auth/crypto";
import { DomainError } from "./errors";

export const STAFF_SESSION_HOURS = 14;

export type StaffIdentity = Pick<StaffMemberRow, "id" | "email" | "name" | "role">;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createStaffMember(
  db: DbOrTx,
  input: { email: string; name: string; password: string; role: StaffRole },
): Promise<StaffIdentity> {
  const email = normalizeEmail(input.email);
  if (input.password.length < 8) {
    throw new DomainError("WEAK_PASSWORD", "La contraseña necesita al menos 8 caracteres.");
  }
  const existing = await db.query.staffMembers.findFirst({ where: eq(staffMembers.email, email) });
  if (existing) {
    throw new DomainError("STAFF_EXISTS", "Ya existe una cuenta con ese email.");
  }
  const [row] = await db
    .insert(staffMembers)
    .values({
      email,
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      role: input.role,
    })
    .returning();
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

/** Crea la cuenta si no existe. No cambia contraseñas existentes. */
export async function ensureStaffMember(
  db: DbOrTx,
  input: { email: string; name: string; password: string; role: StaffRole },
): Promise<{ created: boolean }> {
  const email = normalizeEmail(input.email);
  const existing = await db.query.staffMembers.findFirst({ where: eq(staffMembers.email, email) });
  if (existing) return { created: false };
  await createStaffMember(db, input);
  return { created: true };
}

export const MAX_FAILED_LOGINS = 10;
export const LOCK_MINUTES = 15;

export type AuthResult =
  | { ok: true; staff: StaffIdentity }
  | { ok: false; reason: "INVALID" | "LOCKED" };

const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA";

/**
 * Verifica email y contraseña. Tras MAX_FAILED_LOGINS fallos seguidos la cuenta queda bloqueada
 * LOCK_MINUTES minutos (sin correr scrypt mientras dura el bloqueo).
 */
export async function authenticateStaff(
  db: DbOrTx,
  email: string,
  password: string,
  now: Date = new Date(),
): Promise<AuthResult> {
  const row = await db.query.staffMembers.findFirst({
    where: eq(staffMembers.email, normalizeEmail(email)),
  });
  if (row?.lockedUntil && row.lockedUntil > now) return { ok: false, reason: "LOCKED" };
  // Se verifica igual una contraseña aunque no exista el usuario para no filtrar por tiempos.
  const ok = await verifyPassword(password, row?.passwordHash ?? DUMMY_HASH);
  if (!row || !row.active) return { ok: false, reason: "INVALID" };
  if (!ok) {
    const [updated] = await db
      .update(staffMembers)
      .set({ failedLoginCount: sql`${staffMembers.failedLoginCount} + 1` })
      .where(eq(staffMembers.id, row.id))
      .returning({ failed: staffMembers.failedLoginCount });
    if (updated && updated.failed >= MAX_FAILED_LOGINS) {
      await db
        .update(staffMembers)
        .set({ failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) })
        .where(eq(staffMembers.id, row.id));
      return { ok: false, reason: "LOCKED" };
    }
    return { ok: false, reason: "INVALID" };
  }
  if (row.failedLoginCount !== 0 || row.lockedUntil) {
    await db
      .update(staffMembers)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(eq(staffMembers.id, row.id));
  }
  return { ok: true, staff: { id: row.id, email: row.email, name: row.name, role: row.role } };
}

export async function createStaffSession(
  db: DbOrTx,
  staffId: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + STAFF_SESSION_HOURS * 3600_000);
  await db.insert(staffSessions).values({ staffId, tokenHash: sha256(token), expiresAt });
  // Limpieza oportunista de sesiones vencidas.
  await db.delete(staffSessions).where(lt(staffSessions.expiresAt, now));
  return { token, expiresAt };
}

export async function getStaffBySessionToken(
  db: DbOrTx,
  token: string,
  now: Date = new Date(),
): Promise<StaffIdentity | null> {
  const rows = await db
    .select({
      id: staffMembers.id,
      email: staffMembers.email,
      name: staffMembers.name,
      role: staffMembers.role,
      active: staffMembers.active,
    })
    .from(staffSessions)
    .innerJoin(staffMembers, eq(staffSessions.staffId, staffMembers.id))
    .where(and(eq(staffSessions.tokenHash, sha256(token)), gt(staffSessions.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row || !row.active) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function deleteStaffSession(db: DbOrTx, token: string): Promise<void> {
  await db.delete(staffSessions).where(eq(staffSessions.tokenHash, sha256(token)));
}

export async function listStaffMembers(db: DbOrTx) {
  return db
    .select({
      id: staffMembers.id,
      email: staffMembers.email,
      name: staffMembers.name,
      role: staffMembers.role,
      active: staffMembers.active,
      createdAt: staffMembers.createdAt,
    })
    .from(staffMembers)
    .orderBy(staffMembers.createdAt);
}

export async function setStaffActive(
  db: DbOrTx,
  actorId: string,
  staffId: string,
  active: boolean,
): Promise<void> {
  if (actorId === staffId && !active) {
    throw new DomainError("SELF_DEACTIVATE", "No podés desactivar tu propia cuenta.");
  }
  await db.update(staffMembers).set({ active }).where(eq(staffMembers.id, staffId));
  if (!active) await db.delete(staffSessions).where(eq(staffSessions.staffId, staffId));
}

export async function resetStaffPassword(
  db: DbOrTx,
  staffId: string,
  password: string,
): Promise<void> {
  if (password.length < 8) {
    throw new DomainError("WEAK_PASSWORD", "La contraseña necesita al menos 8 caracteres.");
  }
  await db
    .update(staffMembers)
    .set({ passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null })
    .where(eq(staffMembers.id, staffId));
  await db.delete(staffSessions).where(eq(staffSessions.staffId, staffId));
}
