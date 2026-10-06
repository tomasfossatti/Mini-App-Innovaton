import "dotenv/config";
import { eq } from "drizzle-orm";
import { createDb } from "@/lib/db/client";
import { challenges, events } from "@/lib/db/schema";
import { ensureStaffMember } from "@/lib/services/staff";
import { DEMO_CHALLENGES } from "./demo-data";

// Seed idempotente: se puede correr en cada deploy.
// - Crea la cuenta ADMIN de ADMIN_EMAIL/ADMIN_PASSWORD si no existe (no pisa contraseñas).
// - Si SEED_DEMO != "false", crea el evento "innovaton-demo" con 6 desafíos DEMO si no existe.

const DEMO_SLUG = "innovaton-demo";
const CORDOBA_OFFSET_HOURS = 3; // America/Argentina/Cordoba = UTC-3 (sin horario de verano)

function localTime(date: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h + CORDOBA_OFFSET_HOURS, m));
}

function defaultDemoDate(): string {
  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  return tomorrow.toISOString().slice(0, 10);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[seed] Falta DATABASE_URL");
    process.exit(1);
  }
  const { db, sql } = createDb(url, { max: 1 });
  try {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (email && password) {
      const { created } = await ensureStaffMember(db, {
        email,
        password,
        name: process.env.ADMIN_NAME ?? "Admin",
        role: "ADMIN",
      });
      console.log(created ? `[seed] ADMIN creado: ${email}` : `[seed] ADMIN ya existía: ${email}`);
    } else {
      console.warn("[seed] ADMIN_EMAIL/ADMIN_PASSWORD no definidos: no se creó cuenta ADMIN.");
    }

    if (process.env.SEED_DEMO === "false") {
      console.log("[seed] SEED_DEMO=false: no se crean datos DEMO.");
      return;
    }

    const existing = await db.query.events.findFirst({ where: eq(events.slug, DEMO_SLUG) });
    if (existing) {
      console.log(`[seed] Evento DEMO ya existe (${DEMO_SLUG}).`);
      return;
    }
    const date = process.env.DEMO_EVENT_DATE ?? defaultDemoDate();
    const [event] = await db
      .insert(events)
      .values({
        slug: DEMO_SLUG,
        name: "Innovatón DEMO",
        timezone: "America/Argentina/Cordoba",
        locationLabel: "Stand Espacio IDI",
        registrationOpensAt: localTime(date, "10:00"),
        checkinOpensAt: localTime(date, "14:20"),
        registrationClosesAt: localTime(date, "14:25"),
        startsAt: localTime(date, "14:30"),
        endsAt: localTime(date, "15:35"),
        phase: "REGISTRATION",
        communityUrl: null,
      })
      .returning();
    await db.insert(challenges).values(
      DEMO_CHALLENGES.map((c, i) => ({ ...c, eventId: event.id, sortOrder: i + 1 })),
    );
    console.log(`[seed] Evento DEMO creado: /e/${DEMO_SLUG} (${date}) con ${DEMO_CHALLENGES.length} desafíos.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[seed] Error", err);
  process.exit(1);
});
