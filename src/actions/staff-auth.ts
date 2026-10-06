"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { clearStaffCookie, readStaffToken, setStaffCookie } from "@/lib/auth/staff";
import { authenticateStaff, createStaffSession, deleteStaffSession } from "@/lib/services/staff";
import type { ActionResult } from "./result";

const LoginSchema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
  next: z.string().optional(),
});

export async function loginAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Completá email y contraseña." };
  const db = getDb();
  let result;
  try {
    result = await authenticateStaff(db, parsed.data.email, parsed.data.password);
  } catch (err) {
    console.error("[login]", err);
    return { ok: false, error: "No pudimos verificar tus datos. Probá de nuevo." };
  }
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "LOCKED"
          ? "Demasiados intentos fallidos. Esperá 15 minutos o pedile a una persona ADMIN que te cambie la contraseña."
          : "Email o contraseña incorrectos.",
    };
  }
  const { token } = await createStaffSession(db, result.staff.id);
  await setStaffCookie(token);
  const next = parsed.data.next;
  redirect(next && next.startsWith("/staff") && !next.startsWith("//") ? next : "/staff");
}

export async function logoutAction(): Promise<void> {
  const token = await readStaffToken();
  if (token) await deleteStaffSession(getDb(), token);
  await clearStaffCookie();
  redirect("/staff/login");
}
