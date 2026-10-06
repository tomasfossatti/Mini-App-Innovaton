import { describe, expect, it } from "vitest";
import {
  suggestPlacement,
  type Latecomer,
  type PlacementTeam,
} from "@/lib/domain/latecomers";

function team(
  id: string,
  challengeId: string | null,
  size: number,
  teamNumber: number,
  tableNumber: number,
): PlacementTeam {
  return { id, challengeId, size, teamNumber, tableNumber };
}

function late(
  participationId: string,
  firstChoiceId: string | null,
  secondChoiceId: string | null = null,
  secondChoiceAny = false,
): Latecomer {
  return { participationId, firstChoiceId, secondChoiceId, secondChoiceAny };
}

describe("suggestPlacement — reglas 1 y 2: primera opción", () => {
  it("equipo de 3 de su primera opción → se suma como cuarto", () => {
    const teams = [team("t1", "A", 4, 1, 1), team("t2", "A", 3, 2, 2)];
    expect(suggestPlacement(late("x", "A"), teams, [])).toEqual({
      kind: "JOIN_TEAM",
      teamId: "t2",
      challengeId: "A",
      choice: "FIRST",
      resultingSize: 4,
      exceptional: false,
    });
  });

  it("entre varios equipos de 3 elige el de menor teamNumber", () => {
    const teams = [team("t3", "A", 3, 3, 9), team("t2", "A", 3, 2, 10), team("t1", "A", 4, 1, 1)];
    const suggestion = suggestPlacement(late("x", "A"), teams, []);
    expect(suggestion).toMatchObject({ kind: "JOIN_TEAM", teamId: "t2" });
  });

  it("si solo hay equipos de 4 → quinto excepcional", () => {
    const teams = [team("t2", "A", 4, 2, 2), team("t1", "A", 4, 1, 1)];
    expect(suggestPlacement(late("x", "A", "B"), teams, [])).toEqual({
      kind: "JOIN_TEAM",
      teamId: "t1",
      challengeId: "A",
      choice: "FIRST",
      resultingSize: 5,
      exceptional: true,
    });
  });

  it("el quinto en su primera opción tiene prioridad sobre un equipo de 3 de su segunda", () => {
    const teams = [team("a1", "A", 4, 1, 1), team("b1", "B", 3, 1, 2)];
    const suggestion = suggestPlacement(late("x", "A", "B"), teams, []);
    expect(suggestion).toMatchObject({ teamId: "a1", choice: "FIRST", exceptional: true });
  });
});

describe("suggestPlacement — regla 3: segunda opción", () => {
  it("equipo de 3 de su segunda opción", () => {
    const teams = [team("a1", "A", 5, 1, 1), team("b1", "B", 3, 1, 2)];
    expect(suggestPlacement(late("x", "A", "B"), teams, [])).toEqual({
      kind: "JOIN_TEAM",
      teamId: "b1",
      challengeId: "B",
      choice: "SECOND",
      resultingSize: 4,
      exceptional: false,
    });
  });

  it("equipo de 4 de su segunda opción → quinto excepcional", () => {
    const teams = [team("b1", "B", 4, 1, 2)];
    expect(suggestPlacement(late("x", "A", "B"), teams, [])).toMatchObject({
      kind: "JOIN_TEAM",
      teamId: "b1",
      choice: "SECOND",
      resultingSize: 5,
      exceptional: true,
    });
  });

  it("en su segunda opción también prefiere el equipo de 3 antes que el de 4", () => {
    const teams = [team("b1", "B", 4, 1, 1), team("b2", "B", 3, 2, 2)];
    expect(suggestPlacement(late("x", "A", "B"), teams, [])).toMatchObject({
      teamId: "b2",
      choice: "SECOND",
      exceptional: false,
    });
  });

  it("sin primera opción usa directamente la segunda", () => {
    const teams = [team("b1", "B", 3, 1, 1)];
    expect(suggestPlacement(late("x", null, "B"), teams, [])).toMatchObject({
      teamId: "b1",
      choice: "SECOND",
    });
  });

  it("la segunda opción tiene prioridad sobre armar un equipo nuevo", () => {
    const teams = [team("b1", "B", 4, 1, 2)];
    const others = [late("y", "A"), late("z", "A")];
    expect(suggestPlacement(late("x", "A", "B"), teams, others)).toMatchObject({
      kind: "JOIN_TEAM",
      teamId: "b1",
    });
  });
});

describe("suggestPlacement — regla 4: equipo nuevo", () => {
  it("con 3 compatibles con su primera opción → NEW_TEAM", () => {
    const others = [late("y", "A"), late("w", "C"), late("z", "B", "A")];
    expect(suggestPlacement(late("x", "A"), [], others)).toEqual({
      kind: "NEW_TEAM",
      challengeId: "A",
      choice: "FIRST",
      participationIds: ["x", "y", "z"],
    });
  });

  it("con 4 compatibles arma un equipo de 4", () => {
    const others = [late("y", "A"), late("z", "A"), late("w", "C", "A")];
    expect(suggestPlacement(late("x", "A"), [], others)).toEqual({
      kind: "NEW_TEAM",
      challengeId: "A",
      choice: "FIRST",
      participationIds: ["x", "y", "z", "w"],
    });
  });

  it("con más de 4 compatibles toma como máximo 4, en el orden recibido", () => {
    const others = ["q", "r", "s", "t", "u"].map((id) => late(id, "A"));
    const suggestion = suggestPlacement(late("x", "A"), [], others);
    expect(suggestion).toEqual({
      kind: "NEW_TEAM",
      challengeId: "A",
      choice: "FIRST",
      participationIds: ["x", "q", "r", "s"],
    });
  });

  it("si no alcanza con la primera, prueba con la segunda", () => {
    const others = [late("y", "A"), late("z", "B"), late("w", "C", "B")];
    expect(suggestPlacement(late("x", "A", "B"), [], others)).toEqual({
      kind: "NEW_TEAM",
      challengeId: "B",
      choice: "SECOND",
      participationIds: ["x", "z", "w"],
    });
  });

  it("no cuenta dos veces al propio latecomer ni a duplicados", () => {
    const me = late("x", "A");
    const others = [me, late("y", "A"), late("y", "A")];
    expect(suggestPlacement(me, [], others)).toEqual({ kind: "MANUAL" });
  });

  it("si el propio latecomer viene en la lista, igual arma el equipo sin repetirlo", () => {
    const me = late("x", "A");
    const others = [late("y", "A"), me, late("z", "C", "A")];
    expect(suggestPlacement(me, [], others)).toEqual({
      kind: "NEW_TEAM",
      challengeId: "A",
      choice: "FIRST",
      participationIds: ["x", "y", "z"],
    });
  });

  it("quien solo eligió 'cualquiera' no cuenta como compatible", () => {
    const others = [late("y", "A"), late("z", "C", null, true)];
    expect(suggestPlacement(late("x", "A"), [], others)).toEqual({ kind: "MANUAL" });
  });

  it("sin primera opción arma el equipo nuevo con la segunda", () => {
    const others = [late("y", "B"), late("z", "C", "B")];
    expect(suggestPlacement(late("x", null, "B"), [], others)).toEqual({
      kind: "NEW_TEAM",
      challengeId: "B",
      choice: "SECOND",
      participationIds: ["x", "y", "z"],
    });
  });

  it("con 2 compatibles no alcanza", () => {
    expect(suggestPlacement(late("x", "A"), [], [late("y", "A")])).toEqual({ kind: "MANUAL" });
  });

  it("el equipo nuevo tiene prioridad sobre ANY", () => {
    const teams = [team("c1", "C", 3, 1, 1)];
    const others = [late("y", "A"), late("z", "A")];
    expect(suggestPlacement(late("x", "A", null, true), teams, others)).toMatchObject({
      kind: "NEW_TEAM",
      challengeId: "A",
    });
  });
});

describe("suggestPlacement — regla 5: cualquiera", () => {
  it("con ANY va al equipo de 3 de menor mesa", () => {
    const teams = [
      team("c1", "C", 4, 1, 1),
      team("d1", "D", 3, 1, 7),
      team("e1", "E", 3, 1, 4),
    ];
    expect(suggestPlacement(late("x", "A", null, true), teams, [])).toEqual({
      kind: "JOIN_TEAM",
      teamId: "e1",
      challengeId: "E",
      choice: "ANY",
      resultingSize: 4,
      exceptional: false,
    });
  });

  it("con ANY y solo equipos de 4 → quinto excepcional en la menor mesa", () => {
    const teams = [team("c1", "C", 4, 1, 3), team("d1", "D", 4, 1, 2), team("e1", "E", 5, 1, 1)];
    expect(suggestPlacement(late("x", null, null, true), teams, [])).toEqual({
      kind: "JOIN_TEAM",
      teamId: "d1",
      challengeId: "D",
      choice: "ANY",
      resultingSize: 5,
      exceptional: true,
    });
  });

  it("sin ANY no se suma a equipos de otros challenges", () => {
    const teams = [team("c1", "C", 3, 1, 1)];
    expect(suggestPlacement(late("x", "A", "B"), teams, [])).toEqual({ kind: "MANUAL" });
  });
});

describe("suggestPlacement — límites", () => {
  it("nunca sugiere equipos de 5 o más", () => {
    const teams = [
      team("a1", "A", 5, 1, 1),
      team("a2", "A", 6, 2, 2),
      team("b1", "B", 5, 1, 3),
      team("c1", "C", 7, 1, 4),
    ];
    expect(suggestPlacement(late("x", "A", "B", true), teams, [])).toEqual({ kind: "MANUAL" });
  });

  it("ignora equipos sin challenge", () => {
    const teams = [team("n1", null, 3, 1, 1)];
    expect(suggestPlacement(late("x", null, null, true), teams, [])).toEqual({ kind: "MANUAL" });
  });

  it("no sugiere equipos de 1 o 2 personas", () => {
    const teams = [team("a1", "A", 2, 1, 1), team("a2", "A", 1, 2, 2)];
    expect(suggestPlacement(late("x", "A", null, true), teams, [])).toEqual({ kind: "MANUAL" });
  });

  it("sin opciones ni compañeros → MANUAL", () => {
    expect(suggestPlacement(late("x", null), [], [])).toEqual({ kind: "MANUAL" });
  });

  it("empate de teamNumber: desempata por id", () => {
    const teams = [team("t9", "A", 3, 1, 5), team("t1", "A", 3, 1, 6)];
    expect(suggestPlacement(late("x", "A"), teams, [])).toMatchObject({ teamId: "t1" });
  });

  it("propiedades en casos generados: nunca 5+, choice coherente, equipo nuevo de 3–4", () => {
    let seed = 18;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const ids = ["A", "B", "C", null];
    const pickId = (): string | null => ids[Math.floor(random() * ids.length)];
    const kinds = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const teams = Array.from({ length: Math.floor(random() * 6) }, (_, j) =>
        team(`t${j}`, pickId(), Math.floor(random() * 7), 1 + Math.floor(random() * 3), j + 1),
      );
      const me = late("me", pickId(), pickId(), random() < 0.4);
      const others = Array.from({ length: Math.floor(random() * 6) }, (_, j) =>
        late(`o${j % 4}`, pickId(), pickId(), random() < 0.4),
      );
      const suggestion = suggestPlacement(me, teams, others);
      kinds.add(suggestion.kind);
      if (suggestion.kind === "JOIN_TEAM") {
        const target = teams.find((t) => t.id === suggestion.teamId);
        expect(target).toBeDefined();
        if (!target) continue;
        expect([3, 4]).toContain(target.size);
        expect(suggestion.challengeId).toBe(target.challengeId);
        expect(suggestion.resultingSize).toBe(target.size + 1);
        expect(suggestion.exceptional).toBe(target.size === 4);
        if (suggestion.choice === "FIRST") expect(me.firstChoiceId).toBe(target.challengeId);
        if (suggestion.choice === "SECOND") expect(me.secondChoiceId).toBe(target.challengeId);
        if (suggestion.choice === "ANY") expect(me.secondChoiceAny).toBe(true);
      } else if (suggestion.kind === "NEW_TEAM") {
        const chosen =
          suggestion.choice === "FIRST" ? me.firstChoiceId : me.secondChoiceId;
        expect(suggestion.challengeId).toBe(chosen);
        expect(suggestion.participationIds[0]).toBe("me");
        expect(suggestion.participationIds.length).toBeGreaterThanOrEqual(3);
        expect(suggestion.participationIds.length).toBeLessThanOrEqual(4);
        expect(new Set(suggestion.participationIds).size).toBe(suggestion.participationIds.length);
        for (const id of suggestion.participationIds.slice(1)) {
          const other = others.find((o) => o.participationId === id);
          expect(
            other?.firstChoiceId === suggestion.challengeId ||
              other?.secondChoiceId === suggestion.challengeId,
          ).toBe(true);
        }
      }
    }
    expect([...kinds].sort()).toEqual(["JOIN_TEAM", "MANUAL", "NEW_TEAM"]);
  });

  it("nunca modifica los equipos recibidos", () => {
    const teams = [team("a1", "A", 3, 1, 1)];
    const snapshot = structuredClone(teams);
    suggestPlacement(late("x", "A"), teams, []);
    expect(teams).toEqual(snapshot);
  });

  it("orden completo de prioridades sobre el mismo escenario", () => {
    const teams = [
      team("a1", "A", 4, 1, 1),
      team("b1", "B", 3, 1, 2),
      team("c1", "C", 3, 1, 3),
    ];
    const others = [late("y", "A"), late("z", "A")];
    const x = late("x", "A", "B", true);
    // 1/2: primera opción (aunque sea quinto excepcional).
    expect(suggestPlacement(x, teams, others)).toMatchObject({ teamId: "a1", choice: "FIRST" });
    // 3: segunda opción cuando la primera está llena.
    const noFirst = teams.map((t) => (t.id === "a1" ? { ...t, size: 5 } : t));
    expect(suggestPlacement(x, noFirst, others)).toMatchObject({ teamId: "b1", choice: "SECOND" });
    // 4: equipo nuevo cuando no hay lugar en primera ni segunda.
    const noSecond = noFirst.filter((t) => t.id !== "b1");
    expect(suggestPlacement(x, noSecond, others)).toMatchObject({ kind: "NEW_TEAM" });
    // 5: ANY cuando no hay compañeros compatibles.
    expect(suggestPlacement(x, noSecond, [])).toMatchObject({ teamId: "c1", choice: "ANY" });
    // 6: manual sin ANY.
    expect(suggestPlacement({ ...x, secondChoiceAny: false }, noSecond, [])).toEqual({
      kind: "MANUAL",
    });
  });
});
