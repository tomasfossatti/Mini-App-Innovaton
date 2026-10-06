import "dotenv/config";
import { eq } from "drizzle-orm";
import { createDb } from "@/lib/db/client";
import { challenges, events, participants, participations } from "@/lib/db/schema";
import { generateToken, sha256 } from "@/lib/auth/crypto";
import { MODES } from "@/lib/domain/constants";
import { zonedDateTimeToUtc, formatIsoDate } from "@/lib/domain/time";
import { DEMO_CHALLENGES } from "./demo-data";

// Simulación para ensayos: crea (o recrea) el evento "innovaton-simulacion" con los desafíos DEMO
// y N personas inscriptas, la mayoría presentes, en fase MATCHING. Uso: pnpm db:simulate [N]
// Nunca toca otros eventos.

const SLUG = "innovaton-simulacion";
const FIRST_NAMES = ["Ana", "Bruno", "Carla", "Diego", "Eli", "Fede", "Gabi", "Hugo", "Ines", "Juan", "Lara", "Mateo", "Nora", "Omar", "Paula", "Rocío", "Sofi", "Tomás", "Uma", "Vale"];
const LAST_NAMES = ["Pérez", "Gómez", "Rodríguez", "Fernández", "López", "Díaz", "Martínez", "Sosa", "Romero", "Álvarez"];

// Generador determinístico para que dos corridas den el mismo escenario.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

async function main() {
  const n = Number(process.argv[2] ?? 40);
  const { db, sql } = createDb(process.env.DATABASE_URL!, { max: 1 });
  const rand = rng(42);
  try {
    const existing = await db.query.events.findFirst({ where: eq(events.slug, SLUG) });
    if (existing) {
      await db.delete(participations).where(eq(participations.eventId, existing.id));
      await db.delete(events).where(eq(events.id, existing.id));
    }
    const date = formatIsoDate(new Date());
    const at = (t: string) => zonedDateTimeToUtc(date, t);
    const [event] = await db
      .insert(events)
      .values({
        slug: SLUG,
        name: "Innovatón SIMULACIÓN",
        registrationOpensAt: at("10:00"),
        checkinOpensAt: at("14:20"),
        registrationClosesAt: at("14:25"),
        startsAt: at("14:30"),
        endsAt: at("15:35"),
        phase: "MATCHING",
      })
      .returning();
    const chs = await db
      .insert(challenges)
      .values(DEMO_CHALLENGES.map((c, i) => ({ ...c, eventId: event.id, sortOrder: i + 1 })))
      .returning();
    // Demanda despareja a propósito: un desafío muy elegido y otro casi sin gente.
    const weights = [0.32, 0.22, 0.18, 0.14, 0.11, 0.03];
    const pick = () => {
      let r = rand();
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
      }
      return 0;
    };
    for (let i = 0; i < n; i++) {
      const first = pick();
      let second = pick();
      if (second === first) second = (first + 1) % chs.length;
      const any = rand() < 0.3;
      const present = rand() < 0.85;
      const name = `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)]} (SIM ${i + 1})`;
      const phone = `+5493519${String(100000 + i).padStart(6, "0")}`;
      const [person] = await db
        .insert(participants)
        .values({ name, whatsappNormalized: phone })
        .onConflictDoUpdate({ target: participants.whatsappNormalized, set: { name } })
        .returning();
      const mode = MODES[Math.floor(rand() * MODES.length)];
      await db.insert(participations).values({
        eventId: event.id,
        participantId: person.id,
        resumeTokenHash: sha256(generateToken()),
        status: present ? "CHECKED_IN" : "REGISTERED",
        preClarity: 1 + Math.floor(rand() * 5),
        initialMode: mode,
        exploreScore: mode === "EXPLORE" ? 3 : 1,
        createScore: mode === "CREATE" ? 3 : 1,
        driveScore: mode === "DRIVE" ? 3 : 1,
        firstChoiceId: chs[first].id,
        secondChoiceId: any ? null : chs[second].id,
        secondChoiceAny: any,
        operationalConsentAt: new Date(),
        registeredAt: new Date(),
        checkedInAt: present ? new Date(Date.now() - (n - i) * 5000) : null,
      });
    }
    console.log(`[simulate] Evento ${SLUG} con ${n} inscriptos (fase MATCHING). Panel: /staff/events/${event.id}/teams`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
