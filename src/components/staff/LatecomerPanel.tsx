"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { assignLatecomerAction, createTeamWithMembersAction, moveParticipantAction } from "@/actions/staff";
import type { BoardPerson, BoardTeam } from "@/lib/services/teams";
import { MODE_SHORT } from "@/lib/domain/copy";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useActionRunner } from "@/components/ui/useActionRunner";
import type { TeamOption } from "./TeamCard";

function LatecomerRow({
  eventId,
  person,
  teams,
  options,
  challengeName,
  nameById,
  published,
  canMove,
}: {
  eventId: string;
  person: BoardPerson;
  teams: BoardTeam[];
  options: TeamOption[];
  challengeName: (id: string | null) => string;
  nameById: Map<string, string>;
  published: boolean;
  /** Mover a mano es ADMIN; las sugerencias (nunca mueven a nadie que ya tenga equipo) son para todo el staff. */
  canMove: boolean;
}) {
  const router = useRouter();
  const { run, pending, error } = useActionRunner();
  const [manual, setManual] = useState("");
  const s = person.suggestion;
  const teamOf = (id: string) => teams.find((t) => t.id === id);

  let suggestion: React.ReactNode = null;
  if (s?.kind === "JOIN_TEAM") {
    const t = teamOf(s.teamId);
    const label = t ? `${t.startupName} · Equipo ${t.teamNumber} · Mesa ${t.tableNumber}` : "equipo sugerido";
    suggestion = (
      <Button
        size="md"
        variant={s.exceptional ? "secondary" : "primary"}
        pending={pending}
        onClick={() => {
          if (s.exceptional && !confirm(`Quedaría como quinto integrante (excepcional) en ${label}. ¿Confirmás?`)) return;
          void run(() => assignLatecomerAction(eventId, person.participationId, s.teamId, s.exceptional)).then((res) => {
            if (res && !res.ok) router.refresh();
          });
        }}
      >
        {s.exceptional ? "Sumar como 5º: " : "Sumar a "}
        {label}
      </Button>
    );
  } else if (s?.kind === "NEW_TEAM") {
    const names = s.participationIds.map((id) => nameById.get(id) ?? "?").join(", ");
    suggestion = (
      <Button
        size="md"
        pending={pending}
        onClick={() => {
          if (confirm(`¿Crear un equipo nuevo de ${challengeName(s.challengeId)} con ${names}?`)) {
            void run(() => createTeamWithMembersAction(eventId, s.challengeId, s.participationIds));
          }
        }}
      >
        Nuevo equipo {challengeName(s.challengeId)} ({s.participationIds.length})
      </Button>
    );
  } else if (published) {
    suggestion = <span className="text-sm font-semibold text-warn">Resolver a mano</span>;
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{person.name}</span>
        {person.initialMode ? <Badge>{MODE_SHORT[person.initialMode]}</Badge> : null}
        <span className="text-sm text-muted">
          1ª {challengeName(person.firstChoiceId)} · 2ª{" "}
          {person.secondChoiceAny ? "Cualquiera" : challengeName(person.secondChoiceId)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {suggestion}
        {canMove ? (
        <select
          aria-label={`Asignar a ${person.name} manualmente`}
          className="min-h-11 w-full min-w-0 max-w-full rounded-xl border border-line bg-paper px-2 text-sm sm:w-auto"
          value={manual}
          disabled={pending}
          onChange={(e) => {
            const target = e.target.value;
            setManual(target);
            if (target) void run(() => moveParticipantAction(eventId, person.participationId, target));
          }}
        >
          <option value="">Asignar a mano…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        ) : null}
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </li>
  );
}

export function LatecomerPanel({
  eventId,
  people,
  teams,
  options,
  challenges,
  published,
  canMove = true,
}: {
  eventId: string;
  people: BoardPerson[];
  teams: BoardTeam[];
  options: TeamOption[];
  challenges: { id: string; startupName: string }[];
  published: boolean;
  canMove?: boolean;
}) {
  const names = new Map(challenges.map((c) => [c.id, c.startupName]));
  const challengeName = (id: string | null) => (id ? (names.get(id) ?? "—") : "—");
  const nameById = new Map(people.map((p) => [p.participationId, p.name]));
  return (
    <ul className="divide-y divide-line">
      {people.map((p) => (
        <LatecomerRow
          key={p.participationId}
          eventId={eventId}
          person={p}
          teams={teams}
          options={options}
          challengeName={challengeName}
          nameById={nameById}
          published={published}
          canMove={canMove}
        />
      ))}
    </ul>
  );
}
