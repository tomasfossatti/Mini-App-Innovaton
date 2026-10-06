import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { connectionUrl } from "./url";

export type DB = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
/** Una conexión o una transacción: los servicios aceptan cualquiera de las dos. */
export type DbOrTx = DB | Tx;

type Cached = { sql: postgres.Sql; db: DB };
const globalForDb = globalThis as unknown as { __innovatonDb?: Cached };

export function createDb(url: string, options: { max?: number } = {}): Cached {
  const sql = postgres(connectionUrl(url), {
    // Compatible con poolers en modo transacción (Neon, Supabase pgbouncer).
    prepare: false,
    max: options.max ?? (process.env.NODE_ENV === "production" ? 5 : 10),
    idle_timeout: 20,
    connect_timeout: 15,
  });
  return { sql, db: drizzle(sql, { schema }) };
}

/** Conexión singleton de la app. Se crea al primer uso, nunca en build. */
export function getDb(): DB {
  if (!globalForDb.__innovatonDb) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("Falta la variable de entorno DATABASE_URL");
    }
    globalForDb.__innovatonDb = createDb(url);
  }
  return globalForDb.__innovatonDb.db;
}

export { schema };
