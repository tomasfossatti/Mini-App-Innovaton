import { execSync } from "node:child_process";
import postgres from "postgres";

const URL = process.env.E2E_DATABASE_URL ?? "postgres://innovaton:innovaton@localhost:5432/innovaton_e2e";
export const E2E_ADMIN = { email: "admin@e2e.local", password: "e2e-password-123" };

/** Deja la base e2e vacía, migrada y con el seed (ADMIN + evento DEMO) antes de cada corrida. */
export default async function globalSetup() {
  if (!URL.includes("e2e")) throw new Error("E2E_DATABASE_URL debe apuntar a una base *_e2e");
  const sql = postgres(URL, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  } finally {
    await sql.end();
  }
  const env = {
    ...process.env,
    DATABASE_URL: URL,
    ADMIN_EMAIL: E2E_ADMIN.email,
    ADMIN_PASSWORD: E2E_ADMIN.password,
    ADMIN_NAME: "Admin E2E",
    SEED_DEMO: "true",
  };
  execSync("pnpm -s db:migrate", { env, stdio: "inherit" });
  execSync("pnpm -s db:seed", { env, stdio: "inherit" });
}
