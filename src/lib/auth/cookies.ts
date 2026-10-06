/** Secure por defecto en producción; COOKIE_SECURE=false permite probar `next start` por http. */
export function cookieSecure(): boolean {
  if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === "true";
  return process.env.NODE_ENV === "production";
}
