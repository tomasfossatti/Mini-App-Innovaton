import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../src/lib/db/schema";

const URL = process.env.E2E_DATABASE_URL ?? "postgres://innovaton:innovaton@localhost:5432/innovaton_e2e";

/** Acceso directo a la base e2e para preparar escenarios y verificar resultados. */
export function e2eDb() {
  const sql = postgres(URL, { max: 2, prepare: false, onnotice: () => {} });
  return { sql, db: drizzle(sql, { schema }) };
}
