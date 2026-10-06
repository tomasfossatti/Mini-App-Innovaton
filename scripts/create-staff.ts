import "dotenv/config";
import { createDb } from "@/lib/db/client";
import { createStaffMember } from "@/lib/services/staff";

// Uso: pnpm staff:create <email> <contraseña> "<nombre>" [ADMIN|STAFF]
async function main() {
  const [email, password, name, role = "STAFF"] = process.argv.slice(2);
  if (!email || !password || !name || (role !== "ADMIN" && role !== "STAFF")) {
    console.error('Uso: pnpm staff:create <email> <contraseña> "<nombre>" [ADMIN|STAFF]');
    process.exit(1);
  }
  const { db, sql } = createDb(process.env.DATABASE_URL!, { max: 1 });
  try {
    const staff = await createStaffMember(db, { email, password, name, role });
    console.log(`Cuenta creada: ${staff.email} (${staff.role})`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
