"use client";

import { useMemo, useState } from "react";
import { manualCheckInAction, undoCheckInAction } from "@/actions/staff";
import type { DashboardPerson } from "@/lib/services/operations";
import { MODE_SHORT } from "@/lib/domain/copy";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";
import { useActionRunner } from "@/components/ui/useActionRunner";
import { STATUS_LABELS } from "./labels";

type Filter = "all" | "pending" | "present" | "unassigned";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "pending", label: "Sin check-in" },
  { key: "present", label: "Presentes" },
  { key: "unassigned", label: "Presentes sin equipo" },
];

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function matches(p: DashboardPerson, filter: Filter): boolean {
  if (filter === "pending") return p.status === "REGISTERED" || p.status === "NO_SHOW";
  if (filter === "present") return p.checkedInAt !== null;
  if (filter === "unassigned") return p.checkedInAt !== null && !p.team;
  return true;
}

function PersonRow({ person, eventId, reminder }: { person: DashboardPerson; eventId: string; reminder: string }) {
  const { run, pending, error } = useActionRunner();
  const status = STATUS_LABELS[person.status];
  const canCheckIn = person.status === "REGISTERED" || person.status === "NO_SHOW";
  const canUndo = person.status === "CHECKED_IN" && !person.team;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-bold">{person.name}</span>
          <Badge tone={status.tone}>{status.label}</Badge>
          {person.initialMode ? <Badge>{MODE_SHORT[person.initialMode]}</Badge> : null}
          {person.addedByStaff ? <Badge tone="accent">Alta staff</Badge> : null}
        </div>
        <p className="mt-0.5 text-sm text-muted">
          <a
            href={`https://wa.me/${person.waNumber}?text=${encodeURIComponent(reminder)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand underline-offset-2 hover:underline"
          >
            {person.whatsapp}
          </a>
          {" · "}1ª {person.firstChoice ?? "—"} · 2ª {person.secondChoice ?? "—"}
          {person.team ? ` · ${person.team.startupName} Eq. ${person.team.teamNumber} · Mesa ${person.team.tableNumber}` : ""}
          {person.team && !person.team.published ? " (borrador)" : ""}
        </p>
        {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
      </div>
      {canCheckIn ? (
        <Button size="md" pending={pending} onClick={() => void run(() => manualCheckInAction(eventId, person.participationId))}>
          Check-in
        </Button>
      ) : null}
      {canUndo ? (
        <Button
          size="sm"
          variant="ghost"
          pending={pending}
          onClick={() => {
            if (confirm(`¿Deshacer el check-in de ${person.name}?`)) {
              void run(() => undoCheckInAction(eventId, person.participationId));
            }
          }}
        >
          Deshacer
        </Button>
      ) : null}
    </li>
  );
}

export function PeopleList({
  eventId,
  people,
  reminder,
}: {
  eventId: string;
  people: DashboardPerson[];
  reminder: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const visible = useMemo(() => {
    const q = normalize(query.trim());
    const digits = query.replace(/\D/g, "");
    return people.filter((p) => {
      if (!matches(p, filter)) return false;
      if (!q) return true;
      return normalize(p.name).includes(q) || (digits.length >= 3 && p.whatsapp.replace(/\D/g, "").includes(digits));
    });
  }, [people, query, filter]);

  return (
    <div className="space-y-3">
      <TextInput
        type="search"
        placeholder="Buscar por nombre o teléfono"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Buscar participante"
      />
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count = people.filter((p) => matches(p, f.key)).length;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={cn(
                "min-h-10 rounded-full border px-4 text-sm font-semibold",
                filter === f.key ? "border-brand bg-brand text-white" : "border-line bg-paper",
              )}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </div>
      {visible.length === 0 ? (
        <p className="py-6 text-center text-muted">
          {people.length === 0 ? "Todavía no hay inscriptos." : "No hay personas con ese criterio."}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {visible.map((p) => (
            <PersonRow key={p.participationId} person={p} eventId={eventId} reminder={reminder} />
          ))}
        </ul>
      )}
    </div>
  );
}
