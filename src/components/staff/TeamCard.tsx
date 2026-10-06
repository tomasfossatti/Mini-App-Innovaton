"use client";

import Link from "next/link";
import { useState } from "react";
import { deleteTeamAction, moveParticipantAction, setTableNumberAction } from "@/actions/staff";
import type { BoardTeam } from "@/lib/services/teams";
import { MODE_SHORT } from "@/lib/domain/copy";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { useActionRunner } from "@/components/ui/useActionRunner";
import { SOURCE_LABELS } from "./labels";

export interface TeamOption {
  id: string;
  label: string;
}

function MemberRow({
  eventId,
  member,
  teamId,
  options,
  readOnly,
  published,
}: {
  eventId: string;
  member: BoardTeam["members"][number];
  teamId: string;
  options: TeamOption[];
  readOnly: boolean;
  published: boolean;
}) {
  const { run, pending, error } = useActionRunner();
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{member.name}</span>
        {member.initialMode ? <Badge>{MODE_SHORT[member.initialMode]}</Badge> : <Badge>sin modo</Badge>}
        {member.assignmentSource ? <Badge tone="neutral">{SOURCE_LABELS[member.assignmentSource]}</Badge> : null}
      </div>
      {readOnly ? null : (
      <label className="mt-1 flex min-w-0 items-center gap-2 text-sm">
        <span className="shrink-0 text-muted">Mover a</span>
        <select
          className="min-h-10 w-full min-w-0 flex-1 truncate rounded-xl border border-line bg-paper px-2"
          value={teamId}
          disabled={pending}
          onChange={(e) => {
            const target = e.target.value;
            const label = target === "NONE" ? "sin equipo" : (options.find((o) => o.id === target)?.label ?? "otro equipo");
            // Con equipos publicados la persona ve el cambio en su celular: se confirma.
            if (published && !confirm(`¿Mover a ${member.name} a ${label}? Lo va a ver en su celular.`)) {
              e.target.value = teamId;
              return;
            }
            void run(() => moveParticipantAction(eventId, member.participationId, target === "NONE" ? null : target));
          }}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
          <option value="NONE">Sin equipo</option>
        </select>
      </label>
      )}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </li>
  );
}

export function TeamCard({
  eventId,
  team,
  options,
  readOnly = false,
  tableOwners = {},
}: {
  eventId: string;
  team: BoardTeam;
  options: TeamOption[];
  readOnly?: boolean;
  /** Mesa → "Startup Eq. N", para avisar antes de intercambiar mesas. */
  tableOwners?: Record<number, { teamId: string; label: string }>;
}) {
  const table = useActionRunner();
  const del = useActionRunner();
  const [tableValue, setTableValue] = useState(String(team.tableNumber));
  const size = team.members.length;
  const sizeTone = size >= 6 || size < 3 ? "danger" : size === 5 ? "warn" : "ok";

  return (
    <div className="min-w-0 rounded-3xl border border-line bg-paper p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-muted">{team.startupName}</p>
          <p className="text-xl font-extrabold">Equipo {team.teamNumber}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={sizeTone}>{size} personas</Badge>
          {team.publishedAt ? <Badge tone="brand">Publicado</Badge> : <Badge>Borrador</Badge>}
          {team.winner ? <Badge tone="accent">Reconocimiento</Badge> : null}
        </div>
      </div>
      {readOnly ? (
        <p className="mt-2 text-lg font-bold">Mesa {team.tableNumber}</p>
      ) : (
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(tableValue);
          if (!Number.isInteger(n) || n <= 0 || n === team.tableNumber) return;
          const owner = tableOwners[n];
          if (
            owner &&
            owner.teamId !== team.id &&
            !confirm(
              `La Mesa ${n} es de ${owner.label}: se intercambian y ese equipo pasa a la Mesa ${team.tableNumber}${
                team.publishedAt ? " (lo ven en el celular)" : ""
              }. ¿Seguro?`,
            )
          ) {
            return;
          }
          void table.run(() => setTableNumberAction(eventId, team.id, n));
        }}
      >
        <label className="text-lg font-bold" htmlFor={`table-${team.id}`}>
          Mesa
        </label>
        <input
          id={`table-${team.id}`}
          type="number"
          min={1}
          max={999}
          value={tableValue}
          onChange={(e) => setTableValue(e.target.value)}
          className="min-h-10 w-20 rounded-xl border border-line px-2 text-lg font-bold"
        />
        {tableValue !== String(team.tableNumber) ? (
          <Button type="submit" size="sm" variant="secondary" pending={table.pending}>
            Guardar
          </Button>
        ) : null}
      </form>
      )}
      {table.error ? <p className="text-sm text-danger">{table.error}</p> : null}
      {size === 0 ? (
        <p className="mt-2 text-sm text-muted">Equipo vacío.</p>
      ) : (
        <ul className={cn("mt-2 divide-y divide-line")}>
          {team.members.map((m) => (
            <MemberRow
              key={m.participationId}
              eventId={eventId}
              member={m}
              teamId={team.id}
              options={options}
              readOnly={readOnly}
              published={Boolean(team.publishedAt)}
            />
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <Link
          href={`/staff/events/${eventId}/teams/${team.id}`}
          className="inline-flex min-h-11 items-center rounded-xl bg-brand px-4 font-semibold text-white"
        >
          A3 y evaluación
        </Link>
        <span className="text-muted">
          {team.artifactCount} foto{team.artifactCount === 1 ? "" : "s"} · {team.hasAssessment ? "evaluado" : "sin evaluación"}
        </span>
        {size === 0 && !readOnly ? (
          <Button
            size="sm"
            variant="ghost"
            pending={del.pending}
            onClick={() => {
              if (confirm("¿Borrar este equipo vacío?")) void del.run(() => deleteTeamAction(eventId, team.id));
            }}
          >
            Borrar equipo
          </Button>
        ) : null}
      </div>
      {del.error ? <p className="text-sm text-danger">{del.error}</p> : null}
    </div>
  );
}
