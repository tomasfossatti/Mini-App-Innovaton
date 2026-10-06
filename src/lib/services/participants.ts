import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import { participants, type ParticipantRow } from "@/lib/db/schema";
import { DomainError } from "./errors";

export function cleanName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 2) throw new DomainError("INVALID_NAME", "Escribí tu nombre.");
  if (name.length > 80) throw new DomainError("INVALID_NAME", "El nombre es demasiado largo.");
  return name;
}

/**
 * Busca o crea la persona por WhatsApp normalizado (identidad persistente, 02 §5).
 * Si ya existe, actualiza el nombre con el último ingresado. Seguro ante carreras
 * (ON CONFLICT sobre whatsapp_normalized).
 */
export async function upsertParticipantByWhatsapp(
  db: DbOrTx,
  input: { name: string; whatsappNormalized: string },
): Promise<ParticipantRow> {
  const [row] = await db
    .insert(participants)
    .values({ name: input.name, whatsappNormalized: input.whatsappNormalized })
    .onConflictDoUpdate({
      target: participants.whatsappNormalized,
      set: { name: input.name, updatedAt: sql`now()` },
    })
    .returning();
  return row;
}

export async function findParticipantByWhatsapp(
  db: DbOrTx,
  whatsappNormalized: string,
): Promise<ParticipantRow | null> {
  return (
    (await db.query.participants.findFirst({
      where: eq(participants.whatsappNormalized, whatsappNormalized),
    })) ?? null
  );
}
