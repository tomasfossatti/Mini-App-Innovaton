"use client";

import { useMemo, useState } from "react";
import { createRecoveryCodeAction, manualCheckInAction, undoCheckInAction } from "@/actions/staff";
import type { DashboardPerson } from "@/lib/services/operations";
import { MODE_SHORT } from "@/lib/domain/copy";
import { phoneMatches } from "@/lib/domain/search";
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

/**
 * Código de un solo uso para que la persona recupere su lugar en otro celular. El staff lo dicta
 * cara a cara: el WhatsApp solo no alcanza para abrir una inscripción.
 */
function RecoveryCode({ eventId, person }: { eventId: string; person: DashboardPerson }) {
  const { run, pending, error } = useActionRunner();
  const [issued, setIssued] = useState<{ code: string; expiresAtLabel: string } | null>(null);

  async function generate() {
    const res = await run(() => createRecoveryCodeAction(eventId, person.participationId));
    if (res?.ok) setIssued(res.data);
  }

  return (
    <div className="w-full space-y-1">
      {issued ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-canvas px-3 py-2 text-sm" role="status">
          <span>
            Código <span className="font-mono text-lg font-bold tracking-widest">{issued.code}</span> · vence{" "}
            {issued.expiresAtLabel}. Dáselo solo a {person.name}.
          </span>
          <Button size="sm" variant="ghost" pending={pending} onClick={() => void generate()}>
            Otro código
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" pending={pending} onClick={() => void generate()}>
          Código para recuperar
        </Button>
      )}
      {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
    </div>
  );
}

function matches(p: DashboardPerson, filter: Filter, recent?: Set<string>): boolean {
  if (filter === "pending") {
    // Quien acaba de hacer check-in queda unos segundos en la lista: así la fila no se corre
    // bajo el dedo y nadie marca presente a la persona equivocada.
    return p.status === "REGISTERED" || p.status === "NO_SHOW" || Boolean(recent?.has(p.participationId));
  }
  if (filter === "present") return p.checkedInAt !== null;
  if (filter === "unassigned") return p.checkedInAt !== null && !p.team;
  return true;
}

function PersonRow({
  person,
  eventId,
  reminder,
  onCheckedIn,
}: {
  person: DashboardPerson;
  eventId: string;
  reminder: string;
  onCheckedIn: (id: string) => void;
}) {
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
          {person.waNumber ? (
            <a
              href={`https://wa.me/${person.waNumber}?text=${encodeURIComponent(reminder)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand underline-offset-2 hover:underline"
            >
              {person.whatsapp}
            </a>
          ) : (
            <span>{person.whatsapp}</span>
          )}
          {" · "}1ª {person.firstChoice ?? "—"} · 2ª {person.secondChoice ?? "—"}
          {person.team ? ` · ${person.team.startupName} Eq. ${person.team.teamNumber} · Mesa ${person.team.tableNumber}` : ""}
          {person.team && !person.team.published ? " (borrador)" : ""}
        </p>
        {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
      </div>
      {canCheckIn ? (
        <Button
          size="md"
          pending={pending}
          onClick={() => {
            onCheckedIn(person.participationId);
            void run(() => manualCheckInAction(eventId, person.participationId));
          }}
        >
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
      <RecoveryCode eventId={eventId} person={person} />
    </li>
  );
}

export function PeopleList({
  eventId,
  people,
  reminder,
  maskedPhones = false,
}: {
  eventId: string;
  people: DashboardPerson[];
  reminder: string;
  /** Cuentas STAFF ven solo los últimos 4 dígitos: la búsqueda por teléfono usa esos 4. */
  maskedPhones?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [recent, setRecent] = useState<Set<string>>(() => new Set());
  const markRecent = (id: string) => {
    setRecent((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      setRecent((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 6000);
  };
  const visible = useMemo(() => {
    const q = normalize(query.trim());
    return people.filter((p) => {
      if (!matches(p, filter, recent)) return false;
      if (!q) return true;
      return normalize(p.name).includes(q) || phoneMatches(p.whatsapp, query, { masked: maskedPhones });
    });
  }, [people, query, filter, recent, maskedPhones]);

  return (
    <div className="space-y-3">
      <TextInput
        type="search"
        placeholder={maskedPhones ? "Buscar por nombre o últimos 4 dígitos" : "Buscar por nombre o teléfono"}
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
            <PersonRow key={p.participationId} person={p} eventId={eventId} reminder={reminder} onCheckedIn={markRecent} />
          ))}
        </ul>
      )}
    </div>
  );
}
