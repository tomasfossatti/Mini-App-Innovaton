// Ubicación de latecomers después de publicar equipos (PRD §18, 02 §18, 03 §11).
// Solo sugiere: nunca mueve miembros existentes ni propone equipos de 5 o más.

export interface PlacementTeam {
  id: string;
  /** Equipos sin challenge se ignoran. */
  challengeId: string | null;
  teamNumber: number;
  tableNumber: number;
  size: number;
}

export interface Latecomer {
  participationId: string;
  firstChoiceId: string | null;
  secondChoiceId: string | null;
  secondChoiceAny: boolean;
}

export type PlacementSuggestion =
  | {
      kind: "JOIN_TEAM";
      teamId: string;
      challengeId: string;
      choice: "FIRST" | "SECOND" | "ANY";
      resultingSize: number;
      /** true = quinto integrante excepcional, requiere aprobación del staff. */
      exceptional: boolean;
    }
  | {
      kind: "NEW_TEAM";
      challengeId: string;
      choice: "FIRST" | "SECOND";
      participationIds: string[];
    }
  | { kind: "MANUAL" };

const MAX_NEW_TEAM_SIZE = 4;

interface EligibleTeam extends PlacementTeam {
  challengeId: string;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function pickTeam(
  teams: EligibleTeam[],
  size: number,
  orderBy: "teamNumber" | "tableNumber",
): EligibleTeam | null {
  let best: EligibleTeam | null = null;
  for (const team of teams) {
    if (team.size !== size) continue;
    if (
      best === null ||
      team[orderBy] < best[orderBy] ||
      (team[orderBy] === best[orderBy] && compareStrings(team.id, best.id) < 0)
    ) {
      best = team;
    }
  }
  return best;
}

function joinSuggestion(
  team: EligibleTeam,
  choice: "FIRST" | "SECOND" | "ANY",
): PlacementSuggestion {
  return {
    kind: "JOIN_TEAM",
    teamId: team.id,
    challengeId: team.challengeId,
    choice,
    resultingSize: team.size + 1,
    exceptional: team.size + 1 > 4,
  };
}

export function suggestPlacement(
  latecomer: Latecomer,
  teams: PlacementTeam[],
  otherUnassigned: Latecomer[],
): PlacementSuggestion {
  const eligible = teams.filter(
    (team): team is EligibleTeam => team.challengeId !== null && team.size < 5,
  );

  const choices: { challengeId: string | null; choice: "FIRST" | "SECOND" }[] = [
    { challengeId: latecomer.firstChoiceId, choice: "FIRST" },
    { challengeId: latecomer.secondChoiceId, choice: "SECOND" },
  ];

  // Reglas 1–3: equipo de 3 de su challenge → cuarto; si no, equipo de 4 → quinto excepcional.
  // Primero con la primera opción y después con la segunda.
  for (const { challengeId, choice } of choices) {
    if (challengeId === null) continue;
    const sameChallenge = eligible.filter((team) => team.challengeId === challengeId);
    const team =
      pickTeam(sameChallenge, 3, "teamNumber") ?? pickTeam(sameChallenge, 4, "teamNumber");
    if (team) return joinSuggestion(team, choice);
  }

  // Regla 4: si llegan 3 compatibles, nuevo equipo (máximo 4 personas).
  const others: Latecomer[] = [];
  const seen = new Set<string>([latecomer.participationId]);
  for (const other of otherUnassigned) {
    if (seen.has(other.participationId)) continue;
    seen.add(other.participationId);
    others.push(other);
  }
  for (const { challengeId, choice } of choices) {
    if (challengeId === null) continue;
    const compatible = others.filter(
      (other) => other.firstChoiceId === challengeId || other.secondChoiceId === challengeId,
    );
    if (compatible.length + 1 >= 3) {
      return {
        kind: "NEW_TEAM",
        challengeId,
        choice,
        participationIds: [
          latecomer.participationId,
          ...compatible.map((other) => other.participationId),
        ].slice(0, MAX_NEW_TEAM_SIZE),
      };
    }
  }

  // Regla 5: "cualquiera, quiero participar" → cualquier equipo de 3; si no, de 4 (excepcional).
  if (latecomer.secondChoiceAny) {
    const team = pickTeam(eligible, 3, "tableNumber") ?? pickTeam(eligible, 4, "tableNumber");
    if (team) return joinSuggestion(team, "ANY");
  }

  return { kind: "MANUAL" };
}
