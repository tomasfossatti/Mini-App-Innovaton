import { cookies } from "next/headers";
import { cookieSecure } from "./cookies";

// Sesión anónima del participante (02 §5): token aleatorio en cookie HttpOnly,
// en la base solo se guarda SHA-256(token).

const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

export function participantCookieName(eventSlug: string): string {
  return `ipt_${eventSlug.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

export async function readParticipantToken(eventSlug: string): Promise<string | null> {
  const store = await cookies();
  return store.get(participantCookieName(eventSlug))?.value ?? null;
}

export async function setParticipantToken(eventSlug: string, token: string): Promise<void> {
  const store = await cookies();
  store.set(participantCookieName(eventSlug), token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearParticipantToken(eventSlug: string): Promise<void> {
  const store = await cookies();
  store.delete(participantCookieName(eventSlug));
}
