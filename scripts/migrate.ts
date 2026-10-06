import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

async function main() {
  const url =
    process.env.MIGRATION_DATABASE_URL ??
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate] Falta DATABASE_URL");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    console.log("[migrate] OK");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[migrate] Error", err);
  process.exit(1);
});
