import { describe, expect, it } from "vitest";
import { canAccess, canReflect, nextStep, type FlowParticipation } from "@/lib/domain/flow";

const base: FlowParticipation = {
  status: "STARTED",
  preClarity: null,
  initialMode: null,
  firstChoiceId: null,
  secondChoiceId: null,
  secondChoiceAny: false,
  teamId: null,
};

describe("nextStep", () => {
  it("sin participación → landing", () => {
    expect(nextStep(null)).toBe("landing");
  });
  it("recorre el flujo previo a la inscripción", () => {
    expect(nextStep(base)).toBe("clarity");
    expect(nextStep({ ...base, preClarity: 3 })).toBe("assessment");
    expect(nextStep({ ...base, preClarity: 3, initialMode: "CREATE" })).toBe("result");
    expect(nextStep({ ...base, preClarity: 3, initialMode: "CREATE", firstChoiceId: "a" })).toBe("challenges");
    expect(
      nextStep({ ...base, preClarity: 3, initialMode: "CREATE", firstChoiceId: "a", secondChoiceAny: true }),
    ).toBe("register");
  });
  it("inscripto → status; reflexión hecha → outcome", () => {
    expect(nextStep({ ...base, status: "REGISTERED" })).toBe("status");
    expect(nextStep({ ...base, status: "NO_SHOW" })).toBe("status");
    expect(nextStep({ ...base, status: "INTERPRETED" })).toBe("outcome");
  });
});

describe("canAccess", () => {
  const ready = { ...base, preClarity: 3, initialMode: "DRIVE" as const, firstChoiceId: "a", secondChoiceId: "b" };
  it("permite volver atrás antes de inscribirse pero no saltar adelante", () => {
    expect(canAccess("clarity", ready, "REGISTRATION")).toBe(true);
    expect(canAccess("register", ready, "REGISTRATION")).toBe(true);
    expect(canAccess("register", { ...base, preClarity: 2 }, "REGISTRATION")).toBe(false);
    expect(canAccess("status", ready, "REGISTRATION")).toBe(false);
  });
  it("después de inscribirse solo status/reflexión/outcome", () => {
    const reg = { ...ready, status: "MATCHED" as const, teamId: "t" };
    expect(canAccess("clarity", reg, "SPRINT")).toBe(false);
    expect(canAccess("status", reg, "SPRINT")).toBe(true);
    expect(canAccess("reflection", reg, "SPRINT")).toBe(false);
    expect(canAccess("reflection", reg, "REFLECTION")).toBe(true);
    expect(canAccess("outcome", reg, "REFLECTION")).toBe(false);
  });
  it("reflexión requiere equipo", () => {
    expect(canReflect({ ...ready, status: "CHECKED_IN" }, "REFLECTION")).toBe(false);
    expect(canReflect({ ...ready, status: "EXPERIENCE_COMPLETED", teamId: "t" }, "CLOSED")).toBe(true);
  });
});
