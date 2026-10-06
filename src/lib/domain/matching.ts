import type { AssignmentSource, Mode } from "@/lib/domain/constants";

// Matching de equipos (docs/innovaton/02-technical-spec.md §13–§16, PRD §16).
// Módulo puro y determinístico: misma entrada → misma salida, sin importar el orden recibido.

export interface MatchingParticipant {
  id: string;
  firstChoiceId: string | null;
  secondChoiceId: string | null;
  secondChoiceAny: boolean;
  mode: Mode | null;
  /** Clave determinística de orden (orden de check-in). */
  order: number;
}

export interface MatchingChallenge {
  id: string;
  sortOrder: number;
}

export interface MatchedMember {
  participantId: string;
  source: AssignmentSource;
  mode: Mode | null;
}

export interface MatchedTeam {
  challengeId: string;
  teamNumber: number;
  tableNumber: number;
  members: MatchedMember[];
}

export type UnresolvedReason =
  | "NO_VALID_CHOICE"
  | "SECOND_CHOICE_NOT_VIABLE"
  | "NO_SECOND_CHOICE"
  | "NO_ANY_TARGET";

export interface UnresolvedParticipant {
  participantId: string;
  reason: UnresolvedReason;
}

export type MatchingWarning =
  | { code: "TEAM_OF_FIVE"; challengeId: string; teamNumber: number }
  | { code: "UNRESOLVED"; count: number };

export interface MatchingResult {
  teams: MatchedTeam[];
  unresolved: UnresolvedParticipant[];
  warnings: MatchingWarning[];
}

export interface MatchingOptions {
  startTableNumber?: number;
}

function repeatFour(count: number): number[] {
  return Array.from({ length: count }, () => 4);
}

/** Partición de un grupo de n personas en equipos (02 §13, literal). */
export function teamSizes(n: number): number[] | "UNRESOLVED" {
  if (n <= 0) return [];
  if (!Number.isInteger(n)) {
    throw new Error(`teamSizes: n debe ser entero (recibido ${n})`);
  }
  if (n === 1 || n === 2) return "UNRESOLVED";
  if (n === 3) return [3];
  if (n === 4) return [4];
  // 5 es el único caso con equipo de 5 (excepcional, PRD §16).
  if (n === 5) return [5];

  switch (n % 4) {
    case 0:
      return repeatFour(n / 4);
    case 3:
      return [3, ...repeatFour((n - 3) / 4)];
    case 2:
      return [3, 3, ...repeatFour((n - 6) / 4)];
    default:
      if (n === 9) return [3, 3, 3];
      return [3, 3, 3, ...repeatFour((n - 9) / 4)];
  }
}

/** Qué tan sana queda la partición de un grupo de n (02 §15). */
export function partitionPenalty(n: number): number {
  if (n <= 0) return 0;
  const sizes = teamSizes(n);
  if (sizes === "UNRESOLVED") return 100;
  if (sizes.includes(5)) return 1;
  return 0;
}

// Orden de reparto por modo (02 §16): EXPLORE, CREATE, DRIVE y al final sin modo.
const MODE_ORDER: readonly (Mode | null)[] = ["EXPLORE", "CREATE", "DRIVE", null];

function modeRank(mode: Mode | null): number {
  const index = MODE_ORDER.indexOf(mode);
  return index === -1 ? MODE_ORDER.length - 1 : index;
}

/**
 * Reparte los miembros de un challenge en equipos de tamaños fijos buscando diversidad
 * de modos (02 §16). Solo se usa después de resolver challenge y tamaños: nunca cambia
 * el challenge ni el source de nadie.
 */
export function balanceByMode(members: MatchedMember[], sizes: number[]): MatchedMember[][] {
  for (const size of sizes) {
    if (!Number.isInteger(size) || size < 0) {
      throw new Error(`balanceByMode: tamaño de equipo inválido (${size})`);
    }
  }
  const capacity = sizes.reduce((sum, size) => sum + size, 0);
  if (capacity !== members.length) {
    throw new Error(
      `balanceByMode: la suma de tamaños (${capacity}) no coincide con la cantidad de miembros (${members.length})`,
    );
  }

  const teams: MatchedMember[][] = sizes.map(() => []);
  const sameModeCounts: number[][] = sizes.map(() => MODE_ORDER.map(() => 0));

  for (let rank = 0; rank < MODE_ORDER.length; rank++) {
    for (const member of members) {
      if (modeRank(member.mode) !== rank) continue;

      let best = -1;
      for (let i = 0; i < teams.length; i++) {
        if (teams[i].length >= sizes[i]) continue;
        if (best === -1) {
          best = i;
          continue;
        }
        const same = sameModeCounts[i][rank];
        const bestSame = sameModeCounts[best][rank];
        if (same < bestSame || (same === bestSame && teams[i].length < teams[best].length)) {
          best = i;
        }
      }

      teams[best].push(member);
      sameModeCounts[best][rank] += 1;
    }
  }

  return teams;
}

interface Candidate {
  participant: MatchingParticipant;
  /** Posición en el orden determinístico (order ASC, id ASC). */
  rank: number;
  first: string | null;
  second: string | null;
}

interface Assignment {
  candidate: Candidate;
  source: AssignmentSource;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function byRank(a: { rank: number }, b: { rank: number }): number {
  return a.rank - b.rank;
}

/**
 * Genera la propuesta de equipos a partir de participantes con check-in (02 §14 más una
 * pasada de consolidación entre grupos inviables).
 */
export function generateMatching(
  participants: MatchingParticipant[],
  challenges: MatchingChallenge[],
  options: MatchingOptions = {},
): MatchingResult {
  // Paso 0: orden determinístico de challenges y participantes.
  const sortedChallenges: MatchingChallenge[] = [];
  const seenChallenges = new Set<string>();
  for (const challenge of [...challenges].sort(
    (a, b) => a.sortOrder - b.sortOrder || compareStrings(a.id, b.id),
  )) {
    if (seenChallenges.has(challenge.id)) continue;
    seenChallenges.add(challenge.id);
    sortedChallenges.push(challenge);
  }
  const isValid = (id: string | null): id is string => id !== null && seenChallenges.has(id);

  const sortedParticipants = [...participants].sort(
    (a, b) => a.order - b.order || compareStrings(a.id, b.id),
  );
  const seenParticipants = new Set<string>();
  const candidates: Candidate[] = sortedParticipants.map((participant, rank) => {
    if (seenParticipants.has(participant.id)) {
      throw new Error(`generateMatching: participante duplicado (${participant.id})`);
    }
    seenParticipants.add(participant.id);
    const first = isValid(participant.firstChoiceId) ? participant.firstChoiceId : null;
    const rawSecond = isValid(participant.secondChoiceId) ? participant.secondChoiceId : null;
    // Una segunda opción igual a la primera no agrega alternativa.
    const second = rawSecond !== null && rawSecond === first ? null : rawSecond;
    return { participant, rank, first, second };
  });

  const groups = new Map<string, Assignment[]>();
  const unresolved: { candidate: Candidate; reason: UnresolvedReason }[] = [];
  const anyPool: Candidate[] = [];
  let pending: Candidate[] = [];

  const byFirst = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    if (candidate.first === null) {
      if (candidate.second !== null) {
        pending.push(candidate);
      } else if (candidate.participant.secondChoiceAny) {
        anyPool.push(candidate);
      } else {
        unresolved.push({ candidate, reason: "NO_VALID_CHOICE" });
      }
      continue;
    }
    const list = byFirst.get(candidate.first) ?? [];
    list.push(candidate);
    byFirst.set(candidate.first, list);
  }

  // Paso 1: primera opción. Grupos de 3+ quedan; los de 1–2 pasan a pendientes.
  for (const [challengeId, list] of byFirst) {
    if (list.length >= 3) {
      groups.set(
        challengeId,
        list.map((candidate) => ({ candidate, source: "FIRST_CHOICE" })),
      );
    } else {
      pending.push(...list);
    }
  }
  pending.sort(byRank);

  // Paso 2: segunda opción hacia grupos viables.
  const joinViableSecondChoices = (): void => {
    pending = pending.filter((candidate) => {
      const group = candidate.second === null ? undefined : groups.get(candidate.second);
      if (!group) return true;
      group.push({ candidate, source: "SECOND_CHOICE" });
      return false;
    });
  };
  joinViableSecondChoices();

  // Paso 3: consolidación. Grupos inviables que juntos suman 3+ en un challenge sin grupo
  // (ej.: 2 eligen A con 2ª B y 2 eligen B con 2ª A → un grupo de 4).
  for (;;) {
    let best: { challengeId: string; members: Assignment[] } | null = null;
    for (const challenge of sortedChallenges) {
      if (groups.has(challenge.id)) continue;
      const members: Assignment[] = [];
      for (const candidate of pending) {
        if (candidate.first === challenge.id) {
          members.push({ candidate, source: "FIRST_CHOICE" });
        } else if (candidate.second === challenge.id) {
          members.push({ candidate, source: "SECOND_CHOICE" });
        }
      }
      if (members.length >= 3 && (best === null || members.length > best.members.length)) {
        best = { challengeId: challenge.id, members };
      }
    }
    if (best === null) break;

    groups.set(best.challengeId, best.members);
    const taken = new Set(best.members.map((member) => member.candidate));
    pending = pending.filter((candidate) => !taken.has(candidate));
    joinViableSecondChoices();
  }

  // Paso 4: pendientes que no encontraron grupo.
  for (const candidate of pending) {
    if (candidate.participant.secondChoiceAny) {
      anyPool.push(candidate);
    } else if (candidate.second !== null) {
      unresolved.push({ candidate, reason: "SECOND_CHOICE_NOT_VIABLE" });
    } else {
      unresolved.push({ candidate, reason: "NO_SECOND_CHOICE" });
    }
  }
  anyPool.sort(byRank);

  // Paso 5: ANY (02 §15). Va al grupo que deja la partición más sana.
  if (groups.size > 0) {
    for (const candidate of anyPool) {
      let target: Assignment[] | null = null;
      let targetPenalty = 0;
      for (const challenge of sortedChallenges) {
        const group = groups.get(challenge.id);
        if (!group) continue;
        const penalty = partitionPenalty(group.length + 1);
        if (
          target === null ||
          penalty < targetPenalty ||
          (penalty === targetPenalty && group.length < target.length)
        ) {
          target = group;
          targetPenalty = penalty;
        }
      }
      target?.push({ candidate, source: "ANY" });
    }
  } else if (anyPool.length >= 3 && sortedChallenges.length > 0) {
    // Sin ningún grupo: las personas ANY forman uno en el challenge más elegido como primera opción.
    const firstCounts = new Map<string, number>();
    for (const candidate of anyPool) {
      if (candidate.first !== null) {
        firstCounts.set(candidate.first, (firstCounts.get(candidate.first) ?? 0) + 1);
      }
    }
    let targetId = sortedChallenges[0].id;
    let targetCount = 0;
    for (const challenge of sortedChallenges) {
      const count = firstCounts.get(challenge.id) ?? 0;
      if (count > targetCount) {
        targetId = challenge.id;
        targetCount = count;
      }
    }
    const sourceFor = (candidate: Candidate): AssignmentSource => {
      if (candidate.first === targetId) return "FIRST_CHOICE";
      if (candidate.second === targetId) return "SECOND_CHOICE";
      return "ANY";
    };
    const group: Assignment[] = anyPool.map((candidate) => ({
      candidate,
      source: sourceFor(candidate),
    }));
    // Quien había quedado sin resolver con ese challenge como primera o segunda opción
    // ahora tiene un grupo viable: se suma con su source real.
    for (let i = unresolved.length - 1; i >= 0; i--) {
      const { candidate } = unresolved[i];
      if (candidate.first === targetId || candidate.second === targetId) {
        group.push({ candidate, source: sourceFor(candidate) });
        unresolved.splice(i, 1);
      }
    }
    groups.set(targetId, group);
  } else {
    for (const candidate of anyPool) {
      unresolved.push({ candidate, reason: "NO_ANY_TARGET" });
    }
  }

  // Paso 6: equipos por challenge, mesas consecutivas.
  const teams: MatchedTeam[] = [];
  let tableNumber = options.startTableNumber ?? 1;
  for (const challenge of sortedChallenges) {
    const group = groups.get(challenge.id);
    if (!group) continue;
    const ordered = [...group].sort((a, b) => a.candidate.rank - b.candidate.rank);
    const sizes = teamSizes(ordered.length);
    if (sizes === "UNRESOLVED") {
      throw new Error(`generateMatching: grupo inviable en ${challenge.id}`);
    }
    const members: MatchedMember[] = ordered.map(({ candidate, source }) => ({
      participantId: candidate.participant.id,
      source,
      mode: candidate.participant.mode,
    }));
    balanceByMode(members, sizes).forEach((teamMembers, index) => {
      teams.push({
        challengeId: challenge.id,
        teamNumber: index + 1,
        tableNumber: tableNumber++,
        members: teamMembers,
      });
    });
  }

  // Paso 7: advertencias para revisión del staff.
  const warnings: MatchingWarning[] = [];
  for (const team of teams) {
    if (team.members.length === 5) {
      warnings.push({ code: "TEAM_OF_FIVE", challengeId: team.challengeId, teamNumber: team.teamNumber });
    }
  }
  if (unresolved.length > 0) {
    warnings.push({ code: "UNRESOLVED", count: unresolved.length });
  }

  return {
    teams,
    unresolved: [...unresolved]
      .sort((a, b) => a.candidate.rank - b.candidate.rank)
      .map(({ candidate, reason }) => ({ participantId: candidate.participant.id, reason })),
    warnings,
  };
}
