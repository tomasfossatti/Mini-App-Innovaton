import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/lib/db/client";
import type { StaffRole } from "@/lib/domain/constants";
import { DomainError } from "@/lib/services/errors";
import { getStaffBySessionToken, STAFF_SESSION_HOURS, type StaffIdentity } from "@/lib/services/staff";
import { cookieSecure } from "./cookies";

export const STAFF_COOKIE = "innovaton_staff";

export async function setStaffCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(STAFF_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: STAFF_SESSION_HOURS * 3600,
  });
}

export async function clearStaffCookie(): Promise<void> {
  const store = await cookies();
  store.delete(STAFF_COOKIE);
}

export async function readStaffToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(STAFF_COOKIE)?.value ?? null;
}

/** Staff de la request actual (memoizado por request). */
export const getCurrentStaff = cache(async (): Promise<StaffIdentity | null> => {
  const token = await readStaffToken();
  if (!token) return null;
  return getStaffBySessionToken(getDb(), token);
});

function hasRole(staff: StaffIdentity, role?: StaffRole): boolean {
  return !role || role === "STAFF" || staff.role === "ADMIN";
}

/** Para páginas: redirige al login si no hay sesión. */
export async function requireStaffPage(role?: StaffRole): Promise<StaffIdentity> {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  if (!hasRole(staff, role)) redirect("/staff");
  return staff;
}

/** Para Server Actions: lanza DomainError si no hay sesión o rol. */
export async function requireStaffAction(role?: StaffRole): Promise<StaffIdentity> {
  const staff = await getCurrentStaff();
  if (!staff) {
    throw new DomainError("UNAUTHORIZED", "Tu sesión de staff venció. Volvé a ingresar.");
  }
  if (!hasRole(staff, role)) {
    throw new DomainError("FORBIDDEN", "Esta acción requiere una cuenta ADMIN.");
  }
  return staff;
}

/** Para Route Handlers: devuelve null si no corresponde (el handler responde 401/403). */
export async function staffForRoute(role?: StaffRole): Promise<StaffIdentity | null> {
  const staff = await getCurrentStaff();
  if (!staff || !hasRole(staff, role)) return null;
  return staff;
}
