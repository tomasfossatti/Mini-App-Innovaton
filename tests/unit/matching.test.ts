import { describe, expect, it } from "vitest";
import type { Mode } from "@/lib/domain/constants";
import {
  balanceByMode,
  generateMatching,
  partitionPenalty,
  teamSizes,
  type MatchedMember,
  type MatchingChallenge,
  type MatchingParticipant,
  type MatchingResult,
} from "@/lib/domain/matching";

const CHALLENGES: MatchingChallenge[] = [
  { id: "A", sortOrder: 1 },
  { id: "B", sortOrder: 2 },
  { id: "C", sortOrder: 3 },
  { id: "D", sortOrder: 4 },
];

let counter = 0;

function person(
  first: string | null,
  options: Partial<Omit<MatchingParticipant, "firstChoiceId">> = {},
): MatchingParticipant {
  counter += 1;
  return {
    id: options.id ?? `p${String(counter).padStart(4, "0")}`,
    firstChoiceId: first,
    secondChoiceId: options.secondChoiceId ?? null,
    secondChoiceAny: options.secondChoiceAny ?? false,
    mode: options.mode === undefined ? "EXPLORE" : options.mode,
    order: options.order ?? counter,
  };
}

function many(
  count: number,
  first: string | null,
  options: Partial<Omit<MatchingParticipant, "firstChoiceId" | "id" | "order">> = {},
): MatchingParticipant[] {
  return Array.from({ length: count }, () => person(first, options));
}

function teamsOf(result: MatchingResult, challengeId: string) {
  return result.teams.filter((team) => team.challengeId === challengeId);
}

function sizesOf(result: MatchingResult, challengeId: string): number[] {
  return teamsOf(result, challengeId).map((team) => team.members.length);
}

function memberOf(result: MatchingResult, participantId: string) {
  for (const team of result.teams) {
    const member = team.members.find((m) => m.participantId === participantId);
    if (member) return { team, member };
  }
  return null;
}

function reasonOf(result: MatchingResult, participantId: string) {
  return result.unresolved.find((u) => u.participantId === participantId)?.reason ?? null;
}

function modeCounts(members: MatchedMember[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const member of members) {
    const key = member.mode ?? "NONE";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

// PRNG determinístico para generar casos y desordenar entradas.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function assignmentMap(result: MatchingResult): Map<string, string> {
  const map = new Map<string, string>();
  for (const team of result.teams) {
    for (const member of team.members) map.set(member.participantId, team.challengeId);
  }
  for (const u of result.unresolved) map.set(u.participantId, `UNRESOLVED:${u.reason}`);
  return map;
}

function assertInvariants(
  participants: MatchingParticipant[],
  challenges: MatchingChallenge[],
  result: MatchingResult,
  startTableNumber = 1,
): void {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const validChallenges = new Set(challenges.map((c) => c.id));

  // Cada participante aparece exactamente una vez.
  const seen: string[] = [
    ...result.teams.flatMap((team) => team.members.map((m) => m.participantId)),
    ...result.unresolved.map((u) => u.participantId),
  ];
  expect(seen.length).toBe(participants.length);
  expect(new Set(seen).size).toBe(participants.length);
  for (const id of seen) expect(byId.has(id)).toBe(true);

  const totals = new Map<string, number>();
  for (const team of result.teams) {
    totals.set(team.challengeId, (totals.get(team.challengeId) ?? 0) + team.members.length);
  }

  result.teams.forEach((team, index) => {
    expect(validChallenges.has(team.challengeId)).toBe(true);
    expect(team.members.length).toBeGreaterThanOrEqual(3);
    expect(team.members.length).toBeLessThanOrEqual(5);
    if (team.members.length === 5) expect(totals.get(team.challengeId)).toBe(5);
    expect(team.tableNumber).toBe(startTableNumber + index);

    for (const member of team.members) {
      const participant = byId.get(member.participantId);
      expect(participant).toBeDefined();
      if (!participant) continue;
      expect(member.mode).toBe(participant.mode);
      if (member.source === "FIRST_CHOICE") {
        expect(participant.firstChoiceId).toBe(team.challengeId);
      } else if (member.source === "SECOND_CHOICE") {
        expect(participant.secondChoiceId).toBe(team.challengeId);
      } else {
        expect(member.source).toBe("ANY");
        expect(participant.secondChoiceAny).toBe(true);
      }
    }
  });

  // Por challenge: números de equipo 1..k y tamaños según teamSizes.
  for (const [challengeId, total] of totals) {
    const teams = result.teams.filter((t) => t.challengeId === challengeId);
    expect(teams.map((t) => t.teamNumber)).toEqual(teams.map((_, i) => i + 1));
    expect(teams.map((t) => t.members.length)).toEqual(teamSizes(total));
  }

  // Quien tiene un challenge válido como primera opción elegido por 3+ personas queda ahí
  // como FIRST_CHOICE (nunca se rompe un grupo viable de primera opción).
  const validOf = (id: string | null): string | null =>
    id !== null && validChallenges.has(id) ? id : null;
  const firstCounts = new Map<string, number>();
  for (const p of participants) {
    const first = validOf(p.firstChoiceId);
    if (first !== null) firstCounts.set(first, (firstCounts.get(first) ?? 0) + 1);
  }
  const placement = new Map<string, { challengeId: string; source: string }>();
  for (const team of result.teams) {
    for (const member of team.members) {
      placement.set(member.participantId, { challengeId: team.challengeId, source: member.source });
    }
  }
  for (const p of participants) {
    const first = validOf(p.firstChoiceId);
    if (first !== null && (firstCounts.get(first) ?? 0) >= 3) {
      expect(placement.get(p.id)).toEqual({ challengeId: first, source: "FIRST_CHOICE" });
    }
  }

  // Nadie queda afuera si había un lugar compatible: el motivo coincide con sus elecciones y
  // ningún challenge que eligió tiene equipos.
  for (const u of result.unresolved) {
    const p = byId.get(u.participantId);
    expect(p).toBeDefined();
    if (!p) continue;
    const first = validOf(p.firstChoiceId);
    const second = validOf(p.secondChoiceId);
    if (first !== null) expect(totals.has(first)).toBe(false);
    if (second !== null) expect(totals.has(second)).toBe(false);
    switch (u.reason) {
      case "NO_VALID_CHOICE":
        expect([first, second, p.secondChoiceAny]).toEqual([null, null, false]);
        break;
      case "SECOND_CHOICE_NOT_VIABLE":
        expect(p.secondChoiceAny).toBe(false);
        expect(second).not.toBeNull();
        expect(second).not.toBe(first);
        break;
      case "NO_SECOND_CHOICE":
        expect(p.secondChoiceAny).toBe(false);
        expect(first).not.toBeNull();
        expect(second === null || second === first).toBe(true);
        break;
      case "NO_ANY_TARGET":
        // ANY solo queda sin destino cuando no se formó ningún equipo.
        expect(p.secondChoiceAny).toBe(true);
        expect(result.teams).toEqual([]);
        break;
    }
  }

  // EXPLORE se reparte primero: dentro de un challenge, la cantidad por equipo difiere a lo sumo en 1.
  for (const challengeId of totals.keys()) {
    const explore = result.teams
      .filter((t) => t.challengeId === challengeId)
      .map((t) => t.members.filter((m) => m.mode === "EXPLORE").length);
    expect(Math.max(...explore) - Math.min(...explore)).toBeLessThanOrEqual(1);
  }

  const fiveWarnings = result.warnings.filter((w) => w.code === "TEAM_OF_FIVE").length;
  expect(fiveWarnings).toBe(result.teams.filter((t) => t.members.length === 5).length);
  const unresolvedWarning = result.warnings.find((w) => w.code === "UNRESOLVED");
  if (result.unresolved.length > 0) {
    expect(unresolvedWarning).toEqual({ code: "UNRESOLVED", count: result.unresolved.length });
  } else {
    expect(unresolvedWarning).toBeUndefined();
  }
}

describe("teamSizes", () => {
  const expected: Record<number, number[] | "UNRESOLVED"> = {
    0: [],
    1: "UNRESOLVED",
    2: "UNRESOLVED",
    3: [3],
    4: [4],
    5: [5],
    6: [3, 3],
    7: [3, 4],
    8: [4, 4],
    9: [3, 3, 3],
    10: [3, 3, 4],
    11: [3, 4, 4],
    12: [4, 4, 4],
    13: [3, 3, 3, 4],
    14: [3, 3, 4, 4],
    15: [3, 4, 4, 4],
    16: [4, 4, 4, 4],
    17: [3, 3, 3, 4, 4],
    18: [3, 3, 4, 4, 4],
    19: [3, 4, 4, 4, 4],
    20: [4, 4, 4, 4, 4],
    21: [3, 3, 3, 4, 4, 4],
    22: [3, 3, 4, 4, 4, 4],
    23: [3, 4, 4, 4, 4, 4],
    24: [4, 4, 4, 4, 4, 4],
    25: [3, 3, 3, 4, 4, 4, 4],
  };

  for (let n = 0; n <= 25; n++) {
    it(`n=${n}`, () => {
      expect(teamSizes(n)).toEqual(expected[n]);
    });
  }

  it("devuelve [] para negativos", () => {
    expect(teamSizes(-3)).toEqual([]);
  });

  it("para n >= 6 suma n y solo usa equipos de 3 y 4", () => {
    for (let n = 6; n <= 200; n++) {
      const sizes = teamSizes(n);
      expect(sizes).not.toBe("UNRESOLVED");
      if (sizes === "UNRESOLVED") continue;
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
      expect(sizes.every((s) => s === 3 || s === 4)).toBe(true);
      expect(sizes.filter((s) => s === 3).length).toBeLessThanOrEqual(3);
    }
  });

  it("rechaza n positivo no entero", () => {
    expect(() => teamSizes(3.5)).toThrow();
    expect(() => teamSizes(Number.NaN)).toThrow();
  });

  it("n <= 0 devuelve [] aunque no sea entero (02 §13)", () => {
    expect(teamSizes(-0.5)).toEqual([]);
  });

  it("sigue el pseudocódigo de 02 §13 hasta n=1000", () => {
    const literal = (n: number): number[] | "UNRESOLVED" => {
      if (n <= 0) return [];
      if (n === 1 || n === 2) return "UNRESOLVED";
      if (n === 3) return [3];
      if (n === 4) return [4];
      if (n === 5) return [5];
      const fours = (k: number) => Array.from({ length: k }, () => 4);
      if (n % 4 === 0) return fours(n / 4);
      if (n % 4 === 3) return [3, ...fours((n - 3) / 4)];
      if (n % 4 === 2) return [3, 3, ...fours((n - 6) / 4)];
      if (n === 9) return [3, 3, 3];
      return [3, 3, 3, ...fours((n - 9) / 4)];
    };
    for (let n = -3; n <= 1000; n++) expect(teamSizes(n)).toEqual(literal(n));
  });
});

describe("partitionPenalty", () => {
  it("sigue 02 §15", () => {
    expect(partitionPenalty(-1)).toBe(0);
    expect(partitionPenalty(0)).toBe(0);
    expect(partitionPenalty(1)).toBe(100);
    expect(partitionPenalty(2)).toBe(100);
    expect(partitionPenalty(3)).toBe(0);
    expect(partitionPenalty(4)).toBe(0);
    expect(partitionPenalty(5)).toBe(1);
    for (let n = 6; n <= 40; n++) expect(partitionPenalty(n)).toBe(0);
  });
});

describe("balanceByMode", () => {
  const m = (id: string, mode: Mode | null): MatchedMember => ({
    participantId: id,
    source: "FIRST_CHOICE",
    mode,
  });

  it("lanza si la suma de tamaños no coincide", () => {
    expect(() => balanceByMode([m("a", "EXPLORE")], [3])).toThrow();
    expect(() => balanceByMode([], [3])).toThrow();
  });

  it("sin miembros ni tamaños devuelve []", () => {
    expect(balanceByMode([], [])).toEqual([]);
  });

  it("respeta los tamaños y reparte equitativamente con un solo modo", () => {
    const members = Array.from({ length: 11 }, (_, i) => m(`x${i}`, "DRIVE"));
    const teams = balanceByMode(members, [3, 4, 4]);
    expect(teams.map((t) => t.length)).toEqual([3, 4, 4]);
    // Ronda a ronda: cada equipo recibe uno antes de que otro reciba dos.
    expect(teams[0].map((x) => x.participantId)).toEqual(["x0", "x3", "x6"]);
    expect(teams[1].map((x) => x.participantId)).toEqual(["x1", "x4", "x7", "x9"]);
    expect(teams[2].map((x) => x.participantId)).toEqual(["x2", "x5", "x8", "x10"]);
  });

  it("con 3E 3C 3I en [3,3,3] cada equipo tiene un modo de cada uno", () => {
    const members = [
      ...["e1", "e2", "e3"].map((id) => m(id, "EXPLORE")),
      ...["c1", "c2", "c3"].map((id) => m(id, "CREATE")),
      ...["d1", "d2", "d3"].map((id) => m(id, "DRIVE")),
    ];
    const teams = balanceByMode(shuffle(members, mulberry32(7)), [3, 3, 3]);
    for (const team of teams) {
      expect(modeCounts(team)).toEqual({ EXPLORE: 1, CREATE: 1, DRIVE: 1 });
    }
  });

  it("con 4E 4C 4I en [4,4,4] todos los equipos tienen los tres modos", () => {
    const members = [
      ...Array.from({ length: 4 }, (_, i) => m(`e${i}`, "EXPLORE")),
      ...Array.from({ length: 4 }, (_, i) => m(`c${i}`, "CREATE")),
      ...Array.from({ length: 4 }, (_, i) => m(`d${i}`, "DRIVE")),
    ];
    const teams = balanceByMode(members, [4, 4, 4]);
    for (const team of teams) {
      const counts = modeCounts(team);
      expect(Object.keys(counts).sort()).toEqual(["CREATE", "DRIVE", "EXPLORE"]);
    }
  });

  it("con 2E 2C 2I en [3,3] cada equipo queda con E, C e I", () => {
    const members = [
      m("d1", "DRIVE"),
      m("e1", "EXPLORE"),
      m("c1", "CREATE"),
      m("d2", "DRIVE"),
      m("e2", "EXPLORE"),
      m("c2", "CREATE"),
    ];
    const teams = balanceByMode(members, [3, 3]);
    for (const team of teams) {
      expect(modeCounts(team)).toEqual({ EXPLORE: 1, CREATE: 1, DRIVE: 1 });
    }
  });

  it("procesa E, C, I y al final sin modo; dentro de cada modo respeta el orden recibido", () => {
    const members = [m("n1", null), m("d1", "DRIVE"), m("c1", "CREATE"), m("e1", "EXPLORE")];
    const [team] = balanceByMode(members, [4]);
    expect(team.map((x) => x.participantId)).toEqual(["e1", "c1", "d1", "n1"]);
  });

  it("reparte también a quienes no tienen modo", () => {
    const members = [
      ...Array.from({ length: 3 }, (_, i) => m(`e${i}`, "EXPLORE")),
      ...Array.from({ length: 3 }, (_, i) => m(`n${i}`, null)),
    ];
    const teams = balanceByMode(members, [3, 3]);
    for (const team of teams) {
      const counts = modeCounts(team);
      expect(counts.EXPLORE).toBeGreaterThanOrEqual(1);
      expect(counts.NONE).toBeGreaterThanOrEqual(1);
    }
  });

  it("con tamaños distintos sigue §16 al pie de la letra aunque no logre la diversidad máxima", () => {
    // 3E 2C 2I en [3,4]: el equipo de 3 se llena antes de que lleguen los de Impulsar.
    const members = [
      ...["e1", "e2", "e3"].map((id) => m(id, "EXPLORE")),
      ...["c1", "c2"].map((id) => m(id, "CREATE")),
      ...["d1", "d2"].map((id) => m(id, "DRIVE")),
    ];
    const teams = balanceByMode(members, [3, 4]);
    expect(teams.map((t) => t.map((x) => x.participantId))).toEqual([
      ["e1", "e3", "c2"],
      ["e2", "c1", "d1", "d2"],
    ]);
  });

  it("coincide con una implementación literal de §16 en casos generados", () => {
    const literal = (members: MatchedMember[], sizes: number[]): MatchedMember[][] => {
      const teams: MatchedMember[][] = sizes.map(() => []);
      for (const mode of ["EXPLORE", "CREATE", "DRIVE", null] as const) {
        for (const member of members.filter((x) => x.mode === mode)) {
          const options = teams
            .map((team, index) => ({ team, index }))
            .filter(({ team, index }) => team.length < sizes[index])
            .sort(
              (a, b) =>
                a.team.filter((x) => x.mode === mode).length -
                  b.team.filter((x) => x.mode === mode).length ||
                a.team.length - b.team.length ||
                a.index - b.index,
            );
          options[0].team.push(member);
        }
      }
      return teams;
    };
    const random = mulberry32(16);
    const modes: (Mode | null)[] = ["EXPLORE", "CREATE", "DRIVE", null];
    for (let i = 0; i < 500; i++) {
      const sizes = Array.from({ length: Math.floor(random() * 6) }, () => 3 + Math.floor(random() * 3));
      const total = sizes.reduce((a, b) => a + b, 0);
      const members = Array.from({ length: total }, (_, j) =>
        m(`m${j}`, modes[Math.floor(random() * modes.length)]),
      );
      expect(balanceByMode(members, sizes)).toEqual(literal(members, sizes));
    }
  });

  it("no cambia source ni datos de los miembros", () => {
    const members: MatchedMember[] = [
      { participantId: "a", source: "ANY", mode: "CREATE" },
      { participantId: "b", source: "SECOND_CHOICE", mode: "EXPLORE" },
      { participantId: "c", source: "FIRST_CHOICE", mode: null },
    ];
    const [team] = balanceByMode(members, [3]);
    expect([...team].sort((x, y) => x.participantId.localeCompare(y.participantId))).toEqual(
      members,
    );
  });
});

describe("generateMatching — tamaños en un challenge", () => {
  for (const n of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 20, 21, 23, 40]) {
    it(`${n} personas en un mismo challenge`, () => {
      const participants = many(n, "A");
      const result = generateMatching(participants, CHALLENGES);
      expect(sizesOf(result, "A")).toEqual(teamSizes(n));
      expect(result.unresolved).toEqual([]);
      expect(result.teams.every((t) => t.members.every((x) => x.source === "FIRST_CHOICE"))).toBe(
        true,
      );
      assertInvariants(participants, CHALLENGES, result);
    });
  }

  it("5 en un challenge genera un equipo de 5 con warning", () => {
    const result = generateMatching(many(5, "B"), CHALLENGES);
    expect(sizesOf(result, "B")).toEqual([5]);
    expect(result.warnings).toEqual([{ code: "TEAM_OF_FIVE", challengeId: "B", teamNumber: 1 }]);
  });

  it("40 en un challenge: 10 equipos de 4 en mesas 1..10", () => {
    const result = generateMatching(many(40, "C"), CHALLENGES);
    expect(sizesOf(result, "C")).toEqual(Array.from({ length: 10 }, () => 4));
    expect(result.teams.map((t) => t.tableNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.warnings).toEqual([]);
  });

  it("sin participantes no hay equipos ni warnings", () => {
    expect(generateMatching([], CHALLENGES)).toEqual({ teams: [], unresolved: [], warnings: [] });
  });
});

describe("generateMatching — grupos de 1 y 2", () => {
  it("1 persona con segunda opción viable se suma a ese grupo", () => {
    const group = many(3, "B");
    const late = person("A", { secondChoiceId: "B" });
    const result = generateMatching([...group, late], CHALLENGES);
    expect(memberOf(result, late.id)?.team.challengeId).toBe("B");
    expect(memberOf(result, late.id)?.member.source).toBe("SECOND_CHOICE");
    expect(sizesOf(result, "B")).toEqual([4]);
    expect(sizesOf(result, "A")).toEqual([]);
    assertInvariants([...group, late], CHALLENGES, result);
  });

  it("2 personas con segunda opción viable: el grupo pasa a 5 y se avisa", () => {
    const group = many(3, "B");
    const pair = many(2, "A", { secondChoiceId: "B" });
    const all = [...group, ...pair];
    const result = generateMatching(all, CHALLENGES);
    expect(sizesOf(result, "B")).toEqual([5]);
    expect(result.warnings).toContainEqual({ code: "TEAM_OF_FIVE", challengeId: "B", teamNumber: 1 });
    assertInvariants(all, CHALLENGES, result);
  });

  it("1 persona con segunda opción inviable queda sin resolver", () => {
    const group = many(3, "B");
    const late = person("A", { secondChoiceId: "C" });
    const result = generateMatching([...group, late], CHALLENGES);
    expect(reasonOf(result, late.id)).toBe("SECOND_CHOICE_NOT_VIABLE");
    expect(result.warnings).toContainEqual({ code: "UNRESOLVED", count: 1 });
  });

  it("2 personas con segunda opción inviable quedan sin resolver", () => {
    const group = many(4, "B");
    const pair = many(2, "A", { secondChoiceId: "C" });
    const result = generateMatching([...group, ...pair], CHALLENGES);
    expect(result.unresolved).toEqual(
      pair.map((p) => ({ participantId: p.id, reason: "SECOND_CHOICE_NOT_VIABLE" })),
    );
    expect(result.warnings).toEqual([{ code: "UNRESOLVED", count: 2 }]);
  });

  it("1 persona con ANY va a un grupo existente", () => {
    const group = many(3, "B");
    const late = person("A", { secondChoiceAny: true });
    const result = generateMatching([...group, late], CHALLENGES);
    expect(memberOf(result, late.id)?.team.challengeId).toBe("B");
    expect(memberOf(result, late.id)?.member.source).toBe("ANY");
    assertInvariants([...group, late], CHALLENGES, result);
  });

  it("2 personas con ANY van a grupos existentes", () => {
    const group = many(3, "B");
    const pair = many(2, "A", { secondChoiceAny: true });
    const all = [...group, ...pair];
    const result = generateMatching(all, CHALLENGES);
    expect(result.unresolved).toEqual([]);
    for (const p of pair) expect(memberOf(result, p.id)?.member.source).toBe("ANY");
    assertInvariants(all, CHALLENGES, result);
  });

  it("1 y 2 personas sin segunda opción ni ANY quedan sin resolver", () => {
    const group = many(3, "B");
    const single = person("A");
    const pair = many(2, "C");
    const all = [...group, single, ...pair];
    const result = generateMatching(all, CHALLENGES);
    expect(result.unresolved).toEqual(
      [single, ...pair].map((p) => ({ participantId: p.id, reason: "NO_SECOND_CHOICE" })),
    );
    assertInvariants(all, CHALLENGES, result);
  });

  it("segunda opción igual a la primera cuenta como sin segunda opción", () => {
    const group = many(3, "B");
    const late = person("A", { secondChoiceId: "A" });
    const result = generateMatching([...group, late], CHALLENGES);
    expect(reasonOf(result, late.id)).toBe("NO_SECOND_CHOICE");
  });
});

describe("generateMatching — consolidación", () => {
  it("caso cruzado A↔B: 2 eligen A (2ª B) y 2 eligen B (2ª A) → un grupo de 4", () => {
    const a = many(2, "A", { secondChoiceId: "B" });
    const b = many(2, "B", { secondChoiceId: "A" });
    const all = [...a, ...b];
    const result = generateMatching(all, CHALLENGES);
    expect(result.unresolved).toEqual([]);
    expect(result.teams).toHaveLength(1);
    expect(result.teams[0].challengeId).toBe("A");
    for (const p of a) expect(memberOf(result, p.id)?.member.source).toBe("FIRST_CHOICE");
    for (const p of b) expect(memberOf(result, p.id)?.member.source).toBe("SECOND_CHOICE");
    assertInvariants(all, CHALLENGES, result);
  });

  it("elige el challenge con más candidatos", () => {
    // A: 2 primeras (2ª B) → candidatos(A) = 2 + 1 (2ª A). B: 1 primera + 4 segundas = 5.
    const a = many(2, "A", { secondChoiceId: "B" });
    const b = [person("B", { secondChoiceId: "A" })];
    const c = many(2, "C", { secondChoiceId: "B" });
    const all = [...a, ...b, ...c];
    const result = generateMatching(all, CHALLENGES);
    expect(sizesOf(result, "B")).toEqual([5]);
    expect(result.unresolved).toEqual([]);
    assertInvariants(all, CHALLENGES, result);
  });

  it("la consolidación incluye a quienes tienen ese challenge como segunda opción", () => {
    // A reúne 2 primeras y 3 segundas (B×2 y D): gana a B, que tiene 4 candidatos.
    const a = many(2, "A", { secondChoiceId: "B" });
    const b = many(2, "B", { secondChoiceId: "A" });
    const d = person("D", { secondChoiceId: "A" });
    const all = [...a, ...b, d];
    const result = generateMatching(all, CHALLENGES);
    expect(sizesOf(result, "A")).toEqual([5]);
    expect(memberOf(result, d.id)?.member.source).toBe("SECOND_CHOICE");
    assertInvariants(all, CHALLENGES, result);
  });

  it("encadena consolidaciones: A↔B y después C↔D", () => {
    const a = many(2, "A", { secondChoiceId: "B" });
    const b = person("B", { secondChoiceId: "A" });
    const c = many(2, "C", { secondChoiceId: "D" });
    const d = person("D", { secondChoiceId: "C" });
    const all = [...a, b, ...c, d];
    const result = generateMatching(all, CHALLENGES);
    expect(result.teams.map((t) => [t.challengeId, t.members.length])).toEqual([
      ["A", 3],
      ["C", 3],
    ]);
    expect(memberOf(result, b.id)?.member.source).toBe("SECOND_CHOICE");
    expect(memberOf(result, d.id)?.member.source).toBe("SECOND_CHOICE");
    expect(result.unresolved).toEqual([]);
    assertInvariants(all, CHALLENGES, result);
  });

  it("empate de candidatos: gana el menor sortOrder aunque su id sea mayor", () => {
    const challenges = [
      { id: "Z", sortOrder: 1 },
      { id: "A", sortOrder: 2 },
    ];
    const toA = many(2, "A", { secondChoiceId: "Z" });
    const toZ = many(2, "Z", { secondChoiceId: "A" });
    const all = [...toA, ...toZ];
    const result = generateMatching(all, challenges);
    expect(result.teams.map((t) => t.challengeId)).toEqual(["Z"]);
    for (const p of toA) expect(memberOf(result, p.id)?.member.source).toBe("SECOND_CHOICE");
    assertInvariants(all, challenges, result);
  });

  it("la consolidación es golosa: toma el challenge con más candidatos aunque otro reparto ubicara a todos", () => {
    // B junta 5 candidatos y A 4. Al formarse B, A queda con 2 y esas personas van a revisión
    // del staff (armar A con 4 y B con 3 ubicaba a todos, pero la regla es la de más candidatos).
    const x = many(2, "A", { secondChoiceId: "B" });
    const y = many(2, "B");
    const w = person("D", { secondChoiceId: "B" });
    const z = many(2, "C", { secondChoiceId: "A" });
    const all = [...x, ...y, w, ...z];
    const result = generateMatching(all, CHALLENGES);
    expect(result.teams.map((t) => [t.challengeId, t.members.length])).toEqual([["B", 5]]);
    expect(result.unresolved).toEqual(
      z.map((p) => ({ participantId: p.id, reason: "SECOND_CHOICE_NOT_VIABLE" })),
    );
    assertInvariants(all, CHALLENGES, result);
  });

  it("con menos de 3 candidatos no consolida", () => {
    const all = [person("A", { secondChoiceId: "B" }), person("B", { secondChoiceId: "A" })];
    const result = generateMatching(all, CHALLENGES);
    expect(result.teams).toEqual([]);
    expect(result.unresolved.map((u) => u.reason)).toEqual([
      "SECOND_CHOICE_NOT_VIABLE",
      "SECOND_CHOICE_NOT_VIABLE",
    ]);
  });

  it("la segunda opción viable tiene prioridad sobre ANY", () => {
    const group = many(3, "B");
    const k = person("A", { secondChoiceId: "B", secondChoiceAny: true });
    const result = generateMatching([...group, k], CHALLENGES);
    expect(memberOf(result, k.id)?.member.source).toBe("SECOND_CHOICE");
  });

  it("con segunda inviable y ANY va al pool ANY, no a resolución manual", () => {
    const group = many(3, "B");
    const k = person("A", { secondChoiceId: "C", secondChoiceAny: true });
    const all = [...group, k];
    const result = generateMatching(all, CHALLENGES);
    expect(memberOf(result, k.id)?.member).toMatchObject({ source: "ANY" });
    expect(memberOf(result, k.id)?.team.challengeId).toBe("B");
    assertInvariants(all, CHALLENGES, result);
  });

  it("primera opción nula con segunda válida solo puede ir a su segunda", () => {
    const group = many(3, "C");
    const late = person(null, { secondChoiceId: "C" });
    const lost = person(null, { secondChoiceId: "D" });
    const all = [...group, late, lost];
    const result = generateMatching(all, CHALLENGES);
    expect(memberOf(result, late.id)?.member.source).toBe("SECOND_CHOICE");
    expect(reasonOf(result, lost.id)).toBe("SECOND_CHOICE_NOT_VIABLE");
    assertInvariants(all, CHALLENGES, result);
  });
});

describe("generateMatching — ANY", () => {
  it("prefiere el grupo que no genera equipo de 5", () => {
    const a = many(4, "A");
    const b = many(3, "B");
    const any = person("D", { secondChoiceAny: true });
    const all = [...a, ...b, any];
    const result = generateMatching(all, CHALLENGES);
    expect(memberOf(result, any.id)?.team.challengeId).toBe("B");
    expect(result.warnings).toEqual([]);
    assertInvariants(all, CHALLENGES, result);
  });

  it("prefiere un grupo grande sin penalty antes que uno de 4 que pasaría a 5", () => {
    const a = many(4, "A");
    const b = many(6, "B");
    const any = person("D", { secondChoiceAny: true });
    const all = [...a, ...b, any];
    const result = generateMatching(all, CHALLENGES);
    expect(memberOf(result, any.id)?.team.challengeId).toBe("B");
    expect(sizesOf(result, "B")).toEqual([3, 4]);
    assertInvariants(all, CHALLENGES, result);
  });

  it("con igual penalty elige el grupo más chico y después el de menor sortOrder", () => {
    const a = many(6, "A");
    const b = many(3, "B");
    const any = person("D", { secondChoiceAny: true });
    const result = generateMatching([...a, ...b, any], CHALLENGES);
    expect(memberOf(result, any.id)?.team.challengeId).toBe("B");

    const c = many(4, "C");
    const b2 = many(4, "B");
    const any2 = person("D", { secondChoiceAny: true });
    const result2 = generateMatching([...c, ...b2, any2], CHALLENGES);
    expect(memberOf(result2, any2.id)?.team.challengeId).toBe("B");
    expect(result2.warnings).toEqual([{ code: "TEAM_OF_FIVE", challengeId: "B", teamNumber: 1 }]);
  });

  it("reparte varias personas ANY una por una según el tamaño actual", () => {
    const a = many(3, "A");
    const b = many(3, "B");
    const anys = many(3, null, { secondChoiceAny: true });
    const all = [...a, ...b, ...anys];
    const result = generateMatching(all, CHALLENGES);
    expect(memberOf(result, anys[0].id)?.team.challengeId).toBe("A");
    expect(memberOf(result, anys[1].id)?.team.challengeId).toBe("B");
    expect(memberOf(result, anys[2].id)?.team.challengeId).toBe("A");
    expect(sizesOf(result, "A")).toEqual([5]);
    expect(sizesOf(result, "B")).toEqual([4]);
    assertInvariants(all, CHALLENGES, result);
  });

  it("sin grupos y 3 personas ANY: forman un grupo en el challenge más elegido", () => {
    const b = many(2, "B", { secondChoiceAny: true });
    const c = person("C", { secondChoiceAny: true });
    const all = [...b, c];
    const result = generateMatching(all, CHALLENGES);
    expect(result.teams).toHaveLength(1);
    expect(result.teams[0].challengeId).toBe("B");
    for (const p of b) expect(memberOf(result, p.id)?.member.source).toBe("FIRST_CHOICE");
    expect(memberOf(result, c.id)?.member.source).toBe("ANY");
    assertInvariants(all, CHALLENGES, result);
  });

  it("sin grupos y sin primeras válidas: usa el challenge de menor sortOrder", () => {
    const all = many(3, null, { secondChoiceAny: true });
    const shuffledChallenges = [CHALLENGES[2], CHALLENGES[0], CHALLENGES[3], CHALLENGES[1]];
    const result = generateMatching(all, shuffledChallenges);
    expect(result.teams.map((t) => t.challengeId)).toEqual(["A"]);
    expect(result.teams[0].members.every((x) => x.source === "ANY")).toBe(true);
    assertInvariants(all, CHALLENGES, result);
  });

  it("sin grupos, empate en primeras: gana el de menor sortOrder", () => {
    const all = [
      person("C", { secondChoiceAny: true }),
      person("B", { secondChoiceAny: true }),
      person("D", { secondChoiceAny: true }),
    ];
    const result = generateMatching(all, CHALLENGES);
    expect(result.teams.map((t) => t.challengeId)).toEqual(["B"]);
  });

  it("sin grupos, quien tiene ese challenge como segunda entra como SECOND_CHOICE", () => {
    const all = [
      person("C", { secondChoiceAny: true }),
      person("D", { secondChoiceId: "C", secondChoiceAny: true }),
      person(null, { secondChoiceAny: true }),
    ];
    const result = generateMatching(all, CHALLENGES);
    expect(result.teams.map((t) => t.challengeId)).toEqual(["C"]);
    expect(result.teams[0].members.map((x) => [x.participantId, x.source])).toEqual([
      [all[0].id, "FIRST_CHOICE"],
      [all[1].id, "SECOND_CHOICE"],
      [all[2].id, "ANY"],
    ]);
    assertInvariants(all, CHALLENGES, result);
  });

  it("sin grupos, el grupo ANY suma a quienes habían quedado sin resolver con ese challenge", () => {
    const pair = many(2, "A");
    const pool = many(3, null, { secondChoiceAny: true });
    const all = [...pair, ...pool];
    const result = generateMatching(all, CHALLENGES);
    expect(result.unresolved).toEqual([]);
    expect(sizesOf(result, "A")).toEqual([5]);
    for (const p of pair) expect(memberOf(result, p.id)?.member.source).toBe("FIRST_CHOICE");
    assertInvariants(all, CHALLENGES, result);

    const viaSecond = person("B", { secondChoiceId: "A" });
    const other = person("D");
    const mixed = [...many(3, null, { secondChoiceAny: true }), person("A"), viaSecond, other];
    const mixedResult = generateMatching(mixed, CHALLENGES);
    expect(sizesOf(mixedResult, "A")).toEqual([5]);
    expect(memberOf(mixedResult, viaSecond.id)?.member.source).toBe("SECOND_CHOICE");
    expect(mixedResult.unresolved).toEqual([{ participantId: other.id, reason: "NO_SECOND_CHOICE" }]);
    assertInvariants(mixed, CHALLENGES, mixedResult);
  });

  it("sin grupos y 2 personas ANY: quedan sin resolver", () => {
    const all = [person("A", { secondChoiceAny: true }), person(null, { secondChoiceAny: true })];
    const result = generateMatching(all, CHALLENGES);
    expect(result.teams).toEqual([]);
    expect(result.unresolved).toEqual(
      all.map((p) => ({ participantId: p.id, reason: "NO_ANY_TARGET" })),
    );
  });

  it("sin challenges válidos nadie forma equipo", () => {
    const all = many(4, null, { secondChoiceAny: true });
    const result = generateMatching(all, []);
    expect(result.teams).toEqual([]);
    expect(result.unresolved.every((u) => u.reason === "NO_ANY_TARGET")).toBe(true);
  });
});

describe("generateMatching — elecciones inválidas", () => {
  it("first inválido con segunda viable va a la segunda", () => {
    const group = many(3, "A");
    const p = person("ZZZ", { secondChoiceId: "A" });
    const result = generateMatching([...group, p], CHALLENGES);
    expect(memberOf(result, p.id)?.member.source).toBe("SECOND_CHOICE");
  });

  it("first y second inválidos sin ANY → NO_VALID_CHOICE", () => {
    const group = many(3, "A");
    const p = person("ZZZ", { secondChoiceId: "YYY" });
    const q = person(null);
    const result = generateMatching([...group, p, q], CHALLENGES);
    expect(reasonOf(result, p.id)).toBe("NO_VALID_CHOICE");
    expect(reasonOf(result, q.id)).toBe("NO_VALID_CHOICE");
  });

  it("first inválido con ANY va al pool ANY", () => {
    const group = many(3, "A");
    const p = person("ZZZ", { secondChoiceAny: true });
    const result = generateMatching([...group, p], CHALLENGES);
    expect(memberOf(result, p.id)?.member.source).toBe("ANY");
  });

  it("3 personas con un first inválido igual no forman grupo", () => {
    const ghosts = many(3, "ZZZ");
    const result = generateMatching(ghosts, CHALLENGES);
    expect(result.teams).toEqual([]);
    expect(result.unresolved.every((u) => u.reason === "NO_VALID_CHOICE")).toBe(true);
  });

  it("rechaza participantes duplicados", () => {
    const p = person("A", { id: "dup" });
    expect(() => generateMatching([p, { ...p }], CHALLENGES)).toThrow();
  });
});

describe("generateMatching — mesas y orden", () => {
  it("numera equipos por challenge y mesas consecutivas en orden de sortOrder", () => {
    const all = [...many(7, "C"), ...many(3, "A"), ...many(8, "B")];
    const result = generateMatching(all, [...CHALLENGES].reverse());
    expect(result.teams.map((t) => [t.challengeId, t.teamNumber, t.tableNumber])).toEqual([
      ["A", 1, 1],
      ["B", 1, 2],
      ["B", 2, 3],
      ["C", 1, 4],
      ["C", 2, 5],
    ]);
    assertInvariants(all, CHALLENGES, result);
  });

  it("respeta startTableNumber", () => {
    const all = [...many(6, "A"), ...many(4, "D")];
    const result = generateMatching(all, CHALLENGES, { startTableNumber: 10 });
    expect(result.teams.map((t) => t.tableNumber)).toEqual([10, 11, 12]);
    assertInvariants(all, CHALLENGES, result, 10);
  });

  it("ordena challenges con igual sortOrder por id", () => {
    const challenges = [
      { id: "Z", sortOrder: 1 },
      { id: "M", sortOrder: 1 },
    ];
    const all = [...many(3, "Z"), ...many(3, "M")];
    const result = generateMatching(all, challenges);
    expect(result.teams.map((t) => t.challengeId)).toEqual(["M", "Z"]);
  });
});

describe("generateMatching — modos", () => {
  it("todos con el mismo modo: reparto equitativo según teamSizes", () => {
    const all = many(10, "A", { mode: "CREATE" });
    const result = generateMatching(all, CHALLENGES);
    expect(sizesOf(result, "A")).toEqual([3, 3, 4]);
  });

  it("balance mixto: cada equipo con los tres modos cuando alcanza", () => {
    const modes: Mode[] = ["DRIVE", "DRIVE", "DRIVE", "EXPLORE", "EXPLORE", "EXPLORE", "CREATE", "CREATE", "CREATE"];
    const all = modes.map((mode) => person("B", { mode }));
    const result = generateMatching(all, CHALLENGES);
    expect(sizesOf(result, "B")).toEqual([3, 3, 3]);
    for (const team of result.teams) {
      expect(modeCounts(team.members)).toEqual({ EXPLORE: 1, CREATE: 1, DRIVE: 1 });
    }
  });

  it("los modos nunca cambian el challenge de nadie", () => {
    const base = [
      ...many(5, "A", { mode: "EXPLORE" }),
      ...many(2, "B", { secondChoiceId: "A", mode: "EXPLORE" }),
      ...many(4, "C", { mode: "EXPLORE" }),
      ...many(1, "D", { secondChoiceAny: true, mode: "EXPLORE" }),
    ];
    const reference = assignmentMap(generateMatching(base, CHALLENGES));
    const modes: (Mode | null)[] = ["EXPLORE", "CREATE", "DRIVE", null];
    for (let shift = 0; shift < 4; shift++) {
      const variant = base.map((p, i) => ({ ...p, mode: modes[(i + shift) % 4] }));
      expect(assignmentMap(generateMatching(variant, CHALLENGES))).toEqual(reference);
    }
  });
});

describe("generateMatching — determinismo e invariantes", () => {
  it("misma entrada desordenada → misma salida", () => {
    const all = [
      ...many(9, "A", { mode: "DRIVE" }),
      ...many(2, "B", { secondChoiceId: "C", mode: "CREATE" }),
      ...many(2, "C", { secondChoiceId: "B" }),
      ...many(3, "D", { secondChoiceAny: true, mode: null }),
      person("ZZZ", { secondChoiceAny: true }),
    ];
    const reference = generateMatching(all, CHALLENGES);
    const random = mulberry32(42);
    for (let i = 0; i < 20; i++) {
      const result = generateMatching(shuffle(all, random), shuffle(CHALLENGES, random));
      expect(result).toEqual(reference);
    }
  });

  it("no modifica las entradas", () => {
    const all = [...many(5, "A"), ...many(2, "B", { secondChoiceAny: true })];
    const challenges = [...CHALLENGES].reverse();
    const snapshot = structuredClone({ all, challenges });
    generateMatching(all, challenges);
    expect({ all, challenges }).toEqual(snapshot);
  });

  it("empates de order se resuelven por id", () => {
    const all = [
      person("A", { id: "c", order: 1, mode: "EXPLORE" }),
      person("A", { id: "a", order: 1, mode: "EXPLORE" }),
      person("A", { id: "b", order: 1, mode: "EXPLORE" }),
    ];
    const result = generateMatching(all, CHALLENGES);
    expect(result.teams[0].members.map((x) => x.participantId)).toEqual(["a", "b", "c"]);
  });

  it("cumple las invariantes con grupos chicos (consolidación y ANY sin grupos)", () => {
    const random = mulberry32(1435);
    const modes: (Mode | null)[] = ["EXPLORE", "CREATE", "DRIVE", null];
    let consolidated = 0;
    let withAny = 0;
    let withoutAnyTarget = 0;
    for (let caseIndex = 0; caseIndex < 1500; caseIndex++) {
      const challengeCount = 2 + Math.floor(random() * 4);
      const challenges: MatchingChallenge[] = Array.from({ length: challengeCount }, (_, i) => ({
        id: `k${i}`,
        sortOrder: Math.floor(random() * 2),
      }));
      const pick = (): string | null => {
        const r = random();
        if (r < 0.1) return null;
        if (r < 0.15) return "invalid";
        return `k${Math.floor(random() * challengeCount)}`;
      };
      const n = Math.floor(random() * 13);
      const participants: MatchingParticipant[] = Array.from({ length: n }, (_, i) => ({
        id: `s${caseIndex}-${i}`,
        firstChoiceId: pick(),
        secondChoiceId: random() < 0.6 ? pick() : null,
        secondChoiceAny: random() < 0.35,
        mode: modes[Math.floor(random() * modes.length)],
        order: Math.floor(random() * 5),
      }));
      const result = generateMatching(participants, challenges);
      assertInvariants(participants, challenges, result);
      expect(generateMatching(shuffle(participants, random), shuffle(challenges, random))).toEqual(
        result,
      );
      if (result.teams.some((t) => t.members.some((x) => x.source === "SECOND_CHOICE"))) {
        consolidated += 1;
      }
      if (result.teams.some((t) => t.members.some((x) => x.source === "ANY"))) withAny += 1;
      if (result.unresolved.some((u) => u.reason === "NO_ANY_TARGET")) withoutAnyTarget += 1;
    }
    // Sanidad del generador: ejercita los caminos menos frecuentes.
    expect(consolidated).toBeGreaterThan(50);
    expect(withAny).toBeGreaterThan(50);
    expect(withoutAnyTarget).toBeGreaterThan(10);
  });

  it("cumple las invariantes en cientos de casos generados", () => {
    const random = mulberry32(2026);
    const modes: (Mode | null)[] = ["EXPLORE", "CREATE", "DRIVE", null];
    for (let caseIndex = 0; caseIndex < 400; caseIndex++) {
      const challengeCount = 1 + Math.floor(random() * 6);
      const challenges: MatchingChallenge[] = Array.from({ length: challengeCount }, (_, i) => ({
        id: `ch${i}`,
        sortOrder: Math.floor(random() * 3),
      }));
      const pick = (): string | null => {
        const r = random();
        if (r < 0.08) return null;
        if (r < 0.12) return "invalid";
        // Sesgo hacia los primeros challenges para generar grupos grandes y chicos.
        return `ch${Math.floor(random() * random() * challengeCount)}`;
      };
      const n = Math.floor(random() * 45);
      const participants: MatchingParticipant[] = Array.from({ length: n }, (_, i) => {
        const r = random();
        return {
          id: `c${caseIndex}-p${i}`,
          firstChoiceId: pick(),
          secondChoiceId: r < 0.5 ? pick() : null,
          secondChoiceAny: r >= 0.4 && random() < 0.5,
          mode: modes[Math.floor(random() * modes.length)],
          order: Math.floor(random() * 20),
        };
      });
      const start = 1 + Math.floor(random() * 5);
      const result = generateMatching(participants, challenges, { startTableNumber: start });
      assertInvariants(participants, challenges, result, start);

      const again = generateMatching(shuffle(participants, random), shuffle(challenges, random), {
        startTableNumber: start,
      });
      expect(again).toEqual(result);

      const remoded = participants.map((p) => ({
        ...p,
        mode: modes[Math.floor(random() * modes.length)],
      }));
      expect(
        assignmentMap(generateMatching(remoded, challenges, { startTableNumber: start })),
      ).toEqual(assignmentMap(result));
    }
  });
});
