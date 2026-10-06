import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import {
  capabilitySignals,
  evidenceItems,
  interpretationSnapshots,
  participations,
  recommendations,
  reflections,
  type EventRow,
} from "@/lib/db/schema";
import {
  CAPABILITIES,
  EVIDENCE_LEVELS,
  PHASES_OPEN_FOR_REFLECTION,
  REFLECTION_ACTIONS,
  type Capability,
  type EvidenceLevel,
  type InterpretationType,
  type Mode,
  type RecommendationType,
  type ReflectionAction,
} from "@/lib/domain/constants";
import { evidenceFromReflection, type EvidenceDraft } from "@/lib/domain/evidence";
import { canReflect } from "@/lib/domain/flow";
import { interpret, type EvidenceInput } from "@/lib/domain/interpretation";
import { generateRecommendation } from "@/lib/domain/recommendations";
import { DomainError } from "./errors";
import { isUuid } from "./events";

// Reflexión final, interpretación y resultado (02 §9 submitReflection, §19–§24, §28;
// 05-evidence-interpretation.md). Reglas:
// - el cuestionario nunca es evidencia: acá solo entran evidence_items de la experiencia;
// - la evidencia de equipo (scope TEAM) se pasa a interpret(), que solo la suma a capacidades
//   con evidencia individual;
// - ausencia de evidencia ≠ ausencia de capacidad (lo resuelven interpret/generateRecommendation).

export interface ReflectionInput {
  postClarity: number;
  selectedActions: ReflectionAction[];
  primaryContributionText: string | null;
  primaryCapability: Capability;
  perceivedValue: number;
  initialModeUsefulness: number;
}

export interface Outcome {
  initialMode: Mode | null;
  reflection: {
    selectedActions: ReflectionAction[];
    primaryContributionText: string | null;
    primaryCapability: Capability;
  };
  interpretation: {
    id: string;
    type: InterpretationType;
    primary: Capability | null;
    secondary: Capability | null;
    primaryLevel: EvidenceLevel | null;
    secondaryLevel: EvidenceLevel | null;
    summary: string;
    signalsText: string | null;
  };
  recommendation: {
    type: RecommendationType;
    capability: Capability;
    action: string;
    rationale: string;
  };
  communityCtaDone: boolean;
}

const MAX_CONTRIBUTION_TEXT = 500;

/**
 * Serializa, por equipo, todo lo que lee o escribe evidencia del equipo: la reflexión de un
 * integrante y las cargas del founder/staff. Evita que una reflexión y una evaluación founder
 * simultáneas se interpreten sin verse entre sí. Siempre se toma ANTES de bloquear filas de
 * participations (y, en las operaciones de staff, después de lockEvent) para no generar ciclos.
 */
export async function lockTeamEvidence(db: DbOrTx, teamId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`team-evidence:${teamId}`}))`);
}

/** Inserta items de evidencia con sus señales. Devuelve los ids creados. */
export async function insertEvidence(
  db: DbOrTx,
  base: { eventId: string; participationId: string | null; teamId: string | null; originRef: string },
  drafts: readonly EvidenceDraft[],
): Promise<string[]> {
  if (drafts.length === 0) return [];
  // Ids generados acá: cada señal queda atada a su item sin depender del orden de RETURNING.
  const rows = drafts.map((d) => ({ id: randomUUID(), draft: d }));
  await db.insert(evidenceItems).values(
    rows.map(({ id, draft: d }) => ({
      id,
      eventId: base.eventId,
      participationId: base.participationId,
      teamId: base.teamId,
      sourceType: d.sourceType,
      scope: d.scope,
      rawCode: d.rawCode,
      rawText: d.rawText,
      sourceWeight: d.sourceWeight,
      confidence: d.confidence,
      originRef: base.originRef,
    })),
  );
  const signals = rows.flatMap(({ id, draft }) =>
    draft.signals.map((s) => ({ evidenceItemId: id, capability: s.capability, strength: s.strength })),
  );
  if (signals.length > 0) await db.insert(capabilitySignals).values(signals);
  return rows.map((r) => r.id);
}

function invalid(message: string): DomainError {
  return new DomainError("INVALID_REFLECTION", message);
}

function isScale(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

/** Validación de negocio (además de Zod en la action). Devuelve la entrada normalizada. */
function normalizeInput(input: ReflectionInput): ReflectionInput {
  if (!isScale(input.postClarity) || !isScale(input.perceivedValue) || !isScale(input.initialModeUsefulness)) {
    throw invalid("Elegí un valor del 1 al 5 en cada pregunta.");
  }
  const raw = Array.isArray(input.selectedActions) ? input.selectedActions : [];
  if (raw.some((a) => !REFLECTION_ACTIONS.includes(a))) {
    throw invalid("Hay una opción que no reconocemos. Volvé a elegir qué hiciste.");
  }
  // Sin duplicados y en el orden de la pregunta, para que "Lo que hiciste" se lea siempre igual.
  const selectedActions = REFLECTION_ACTIONS.filter((a) => raw.includes(a));
  if (selectedActions.length === 0) {
    throw invalid("Elegí al menos una cosa que hayas hecho durante el desafío.");
  }
  const text = typeof input.primaryContributionText === "string" ? input.primaryContributionText.trim() : "";
  if (text.length > MAX_CONTRIBUTION_TEXT) {
    throw invalid(`Tu aporte puede tener hasta ${MAX_CONTRIBUTION_TEXT} caracteres.`);
  }
  if (!CAPABILITIES.includes(input.primaryCapability)) {
    throw invalid("Elegí cuál sentís que fue tu aporte más importante.");
  }
  return {
    postClarity: input.postClarity,
    perceivedValue: input.perceivedValue,
    initialModeUsefulness: input.initialModeUsefulness,
    selectedActions,
    primaryContributionText: text.length > 0 ? text : null,
    primaryCapability: input.primaryCapability,
  };
}

async function latestSnapshotId(db: DbOrTx, participationId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: interpretationSnapshots.id })
    .from(interpretationSnapshots)
    .where(eq(interpretationSnapshots.participationId, participationId))
    .orderBy(desc(interpretationSnapshots.createdAt), desc(interpretationSnapshots.id))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Reflexión final (02 §9). En una sola transacción: reflection → evidence_items →
 * capability_signals → REFLECTION_COMPLETED → interpretación + recomendación → INTERPRETED.
 * Doble submit (secuencial o simultáneo): devuelve el último snapshot sin crear nada (02 §28).
 */
export async function submitReflection(
  db: DbOrTx,
  event: EventRow,
  participationId: string,
  input: ReflectionInput,
  now: Date = new Date(),
  /**
   * Solo para la carga del staff: el modo del cuestionario hecho en papel. Completa un
   * initial_mode vacío antes de interpretar; nunca pisa uno existente ni crea evidencia.
   */
  opts: { initialMode?: Mode | null } = {},
): Promise<{ alreadySubmitted: boolean; interpretationId: string }> {
  const data = normalizeInput(input);
  if (!PHASES_OPEN_FOR_REFLECTION.includes(event.phase)) {
    throw new DomainError(
      "REFLECTION_CLOSED",
      "La reflexión todavía no está abierta. Te avisamos al terminar los pitches.",
    );
  }
  const notFound = new DomainError("NOT_FOUND", "No encontramos tu participación. Empezá de nuevo.");
  if (!isUuid(participationId)) throw notFound;

  return db.transaction(async (tx) => {
    // El lock de evidencia del equipo va antes del FOR UPDATE (ver lockTeamEvidence).
    const preview = await tx.query.participations.findFirst({
      where: and(eq(participations.id, participationId), eq(participations.eventId, event.id)),
      columns: { teamId: true },
    });
    if (!preview) throw notFound;
    if (preview.teamId) await lockTeamEvidence(tx, preview.teamId);

    const [current] = await tx
      .select()
      .from(participations)
      .where(eq(participations.id, participationId))
      .for("update");
    if (!current) throw notFound;

    const existing = await tx.query.reflections.findFirst({
      where: eq(reflections.participationId, participationId),
      columns: { id: true },
    });
    if (existing) {
      const snapshotId = await latestSnapshotId(tx, participationId);
      if (snapshotId) return { alreadySubmitted: true, interpretationId: snapshotId };
      // Defensivo: reflexión sin interpretación (no debería ocurrir, todo va en la misma transacción).
      const interpretationId = await interpretParticipation(tx, participationId);
      await tx.update(participations).set({ status: "INTERPRETED" }).where(eq(participations.id, participationId));
      return { alreadySubmitted: true, interpretationId };
    }

    if (!canReflect(current, event.phase)) {
      throw new DomainError("NO_TEAM", "La reflexión es para quienes participaron en un equipo.");
    }
    if (current.teamId !== preview.teamId) {
      // Lo movieron de equipo entre las dos lecturas: no tomamos otro lock con la fila bloqueada.
      throw new DomainError("RETRY", "Hubo un cambio en tu equipo. Tocá enviar de nuevo.");
    }
    if (opts.initialMode && current.initialMode === null) {
      // interpretParticipation relee la fila en esta misma transacción y usa la hipótesis.
      await tx
        .update(participations)
        .set({ initialMode: opts.initialMode })
        .where(eq(participations.id, participationId));
    }

    const [reflection] = await tx
      .insert(reflections)
      .values({
        participationId,
        postClarity: data.postClarity,
        perceivedValue: data.perceivedValue,
        initialModeUsefulness: data.initialModeUsefulness,
        selectedActions: data.selectedActions,
        primaryContributionText: data.primaryContributionText,
        primaryCapability: data.primaryCapability,
        createdAt: now,
      })
      .returning({ id: reflections.id });

    await insertEvidence(
      tx,
      {
        eventId: current.eventId,
        participationId,
        teamId: current.teamId,
        originRef: `reflection:${reflection.id}`,
      },
      evidenceFromReflection(data),
    );

    await tx
      .update(participations)
      .set({ status: "REFLECTION_COMPLETED" })
      .where(eq(participations.id, participationId));
    const interpretationId = await interpretParticipation(tx, participationId);
    await tx.update(participations).set({ status: "INTERPRETED" }).where(eq(participations.id, participationId));
    return { alreadySubmitted: false, interpretationId };
  });
}

/**
 * Corre Interpretation + Recommendation Engine con la evidencia actual y guarda un snapshot nuevo.
 * Evidencia: items individuales de la persona (reflexión, observaciones) + items de scope TEAM
 * de su equipo actual (founder score, A3). Nada del cuestionario. No cambia el status.
 */
export async function interpretParticipation(db: DbOrTx, participationId: string): Promise<string> {
  if (!isUuid(participationId)) throw new DomainError("NOT_FOUND", "No encontramos la participación.");
  return db.transaction(async (tx) => {
    const p = await tx.query.participations.findFirst({
      where: eq(participations.id, participationId),
      columns: { id: true, initialMode: true, teamId: true },
    });
    if (!p) throw new DomainError("NOT_FOUND", "No encontramos la participación.");

    const own = eq(evidenceItems.participationId, p.id);
    const items = await tx
      .select({
        id: evidenceItems.id,
        sourceType: evidenceItems.sourceType,
        scope: evidenceItems.scope,
        sourceWeight: evidenceItems.sourceWeight,
        confidence: evidenceItems.confidence,
      })
      .from(evidenceItems)
      .where(
        p.teamId
          ? or(own, and(eq(evidenceItems.teamId, p.teamId), eq(evidenceItems.scope, "TEAM")))
          : own,
      )
      .orderBy(asc(evidenceItems.createdAt), asc(evidenceItems.id));

    const itemIds = items.map((i) => i.id);
    const signals = itemIds.length
      ? await tx
          .select({
            evidenceItemId: capabilitySignals.evidenceItemId,
            capability: capabilitySignals.capability,
            strength: capabilitySignals.strength,
          })
          .from(capabilitySignals)
          .where(inArray(capabilitySignals.evidenceItemId, itemIds))
      : [];
    const signalsByItem = new Map<string, { capability: Capability; strength: number }[]>();
    for (const s of signals) {
      const list = signalsByItem.get(s.evidenceItemId) ?? [];
      list.push({ capability: s.capability, strength: s.strength });
      signalsByItem.set(s.evidenceItemId, list);
    }

    const evidence: EvidenceInput[] = items.map((i) => ({
      sourceType: i.sourceType,
      scope: i.scope,
      sourceWeight: i.sourceWeight,
      confidence: i.confidence,
      signals: signalsByItem.get(i.id) ?? [],
    }));

    const interpretation = interpret({ initialMode: p.initialMode, evidence });
    const rec = generateRecommendation(interpretation, p.initialMode);

    const [snapshot] = await tx
      .insert(interpretationSnapshots)
      .values({
        participationId: p.id,
        algorithmVersion: interpretation.algorithmVersion,
        type: interpretation.type,
        primaryCapability: interpretation.primary,
        secondaryCapability: interpretation.secondary,
        summary: interpretation.summary,
        evidenceSnapshot: {
          scores: interpretation.scores,
          signalsText: interpretation.signalsText,
          primaryLevel: interpretation.primaryLevel,
          secondaryLevel: interpretation.secondaryLevel,
          evidenceItemIds: itemIds,
          counts: {
            individual: items.filter((i) => i.scope === "INDIVIDUAL").length,
            team: items.filter((i) => i.scope === "TEAM").length,
          },
        },
        // Hora real de inserción (no la de inicio de la transacción): el "último snapshot" queda
        // en el orden en que se serializaron las re-interpretaciones.
        createdAt: sql`clock_timestamp()`,
      })
      .returning({ id: interpretationSnapshots.id });

    await tx.insert(recommendations).values({
      interpretationId: snapshot.id,
      capability: rec.capability,
      type: rec.type,
      action: rec.action,
      rationale: rec.rationale,
    });
    return snapshot.id;
  });
}

/**
 * Re-interpreta a quienes del equipo ya reflexionaron (tras cambiar la evidencia de equipo).
 * Devuelve cuántas personas se re-interpretaron.
 */
export async function reinterpretTeam(db: DbOrTx, teamId: string): Promise<number> {
  if (!isUuid(teamId)) return 0;
  return db.transaction(async (tx) => {
    const members = await tx
      .select({ id: participations.id })
      .from(participations)
      .innerJoin(reflections, eq(reflections.participationId, participations.id))
      .where(eq(participations.teamId, teamId))
      .orderBy(asc(participations.id));
    for (const m of members) await interpretParticipation(tx, m.id);
    return members.length;
  });
}

function asLevel(value: unknown): EvidenceLevel | null {
  return typeof value === "string" && (EVIDENCE_LEVELS as readonly string[]).includes(value)
    ? (value as EvidenceLevel)
    : null;
}

/** Resultado final (PRD §25) con el ÚLTIMO snapshot. null si todavía no hay reflexión o snapshot. */
export async function getOutcome(db: DbOrTx, participationId: string): Promise<Outcome | null> {
  if (!isUuid(participationId)) return null;
  const [base] = await db
    .select({
      initialMode: participations.initialMode,
      communityCtaAt: participations.communityCtaAt,
      selectedActions: reflections.selectedActions,
      primaryContributionText: reflections.primaryContributionText,
      primaryCapability: reflections.primaryCapability,
    })
    .from(participations)
    .innerJoin(reflections, eq(reflections.participationId, participations.id))
    .where(eq(participations.id, participationId))
    .limit(1);
  if (!base) return null;

  const [row] = await db
    .select({ snapshot: interpretationSnapshots, recommendation: recommendations })
    .from(interpretationSnapshots)
    .innerJoin(recommendations, eq(recommendations.interpretationId, interpretationSnapshots.id))
    .where(eq(interpretationSnapshots.participationId, participationId))
    .orderBy(desc(interpretationSnapshots.createdAt), desc(interpretationSnapshots.id))
    .limit(1);
  if (!row) return null;

  const { snapshot, recommendation } = row;
  const details = (snapshot.evidenceSnapshot ?? {}) as Record<string, unknown>;
  return {
    initialMode: base.initialMode,
    reflection: {
      selectedActions: base.selectedActions,
      primaryContributionText: base.primaryContributionText,
      primaryCapability: base.primaryCapability,
    },
    interpretation: {
      id: snapshot.id,
      type: snapshot.type,
      primary: snapshot.primaryCapability,
      secondary: snapshot.secondaryCapability,
      primaryLevel: asLevel(details.primaryLevel),
      secondaryLevel: asLevel(details.secondaryLevel),
      summary: snapshot.summary,
      signalsText: typeof details.signalsText === "string" ? details.signalsText : null,
    },
    recommendation: {
      type: recommendation.type,
      capability: recommendation.capability,
      action: recommendation.action,
      rationale: recommendation.rationale,
    },
    communityCtaDone: base.communityCtaAt !== null,
  };
}
