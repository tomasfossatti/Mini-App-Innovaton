import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/staff";
import { getDb } from "@/lib/db/client";
import { getEventById } from "@/lib/services/events";
import { boardVersion, getTeamsBoard } from "@/lib/services/teams";
import { AutoRefresh } from "@/components/staff/AutoRefresh";
import { LatecomerPanel } from "@/components/staff/LatecomerPanel";
import { NewTeamButton } from "@/components/staff/NewTeamButton";
import { TeamCard, type TeamOption } from "@/components/staff/TeamCard";
import { TeamsToolbar } from "@/components/staff/TeamsToolbar";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { cn } from "@/components/ui/cn";

export const metadata: Metadata = { title: "Equipos" };

export default async function TeamsPage(props: PageProps<"/staff/events/[eventId]/teams">) {
  const staff = await requireStaffPage();
  const isAdmin = staff.role === "ADMIN";
  const { eventId } = await props.params;
  const sp = await props.searchParams;
  const filter = typeof sp.challenge === "string" ? sp.challenge : null;
  const db = getDb();
  const event = await getEventById(db, eventId);
  if (!event) notFound();
  const fullBoard = await getTeamsBoard(db, event.id);
  // El tablero no muestra teléfonos: no se mandan al navegador (las cuentas STAFF no deben verlos).
  const stripPhone = <T extends { whatsapp: string }>(p: T): T => ({ ...p, whatsapp: "" });
  const board = {
    ...fullBoard,
    unassigned: fullBoard.unassigned.map(stripPhone),
    teams: fullBoard.teams.map((t) => ({ ...t, members: t.members.map(stripPhone) })),
  };

  const options: TeamOption[] = board.teams.map((t) => ({
    id: t.id,
    label: `Mesa ${t.tableNumber} · ${t.startupName} Eq. ${t.teamNumber} (${t.members.length})`,
  }));
  const tableOwners = Object.fromEntries(
    board.teams.map((t) => [t.tableNumber, { teamId: t.id, label: `${t.startupName} Eq. ${t.teamNumber}` }]),
  );
  const presentCount = board.teams.reduce((n, t) => n + t.members.length, 0) + board.unassigned.length;
  const visibleChallenges = board.challenges.filter(
    (c) => (!filter || c.id === filter) && (c.active || board.teams.some((t) => t.challengeId === c.id)),
  );
  const base = `/staff/events/${event.id}/teams`;
  // Con muy poca gente el matching puede no formar ningún equipo: el ADMIN igual puede crear uno
  // a mano (+ Equipo vacío) y asignar a quienes están presentes, aunque sean 1 o 2.
  const buildByHand = isAdmin && board.phase === "MATCHING" && board.unassigned.length > 0;

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={10} />
      {isAdmin ? (
      <TeamsToolbar
        eventId={event.id}
        phase={board.phase}
        published={board.published}
        teamCount={board.teams.length}
        presentCount={presentCount}
        unassignedCount={board.unassigned.length}
        version={boardVersion(fullBoard)}
      />
      ) : (
        <Notice tone="info">
          {board.published
            ? "Equipos publicados. Abrí tu equipo para cargar el A3 y la evaluación."
            : "Los equipos todavía no se publicaron. Los arma y publica una cuenta ADMIN."}
        </Notice>
      )}

      {board.warnings.length ? (
        <Notice tone="warn" title="Revisar">
          <ul className="list-disc pl-5">
            {board.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {board.unassigned.length ? (
        <Card className="space-y-2 border-warn/40">
          <h2 className="text-lg font-bold">
            {board.published ? "Latecomers y presentes sin equipo" : "Presentes sin equipo"} ({board.unassigned.length})
          </h2>
          <p className="text-sm text-muted">
            {board.published
              ? "Sugerencia según las reglas: equipo de 3 de su desafío, después 5º excepcional, después segunda opción, después equipo nuevo si hay 3 compatibles. Nunca se mueve a quienes ya están en un equipo."
              : "Quedaron sin equipo en el matching. Asignalos a mano o creá un equipo con «+ Equipo vacío» en su desafío, aunque sean 1 o 2."}
          </p>
          <LatecomerPanel
            canMove={isAdmin}
            eventId={event.id}
            people={board.unassigned}
            teams={board.teams}
            options={options}
            challenges={board.challenges}
            published={board.published}
          />
        </Card>
      ) : null}

      <nav className="no-print flex flex-wrap gap-2" aria-label="Filtrar por desafío">
        <Link
          href={base}
          className={cn("min-h-10 rounded-full border px-4 py-2 text-sm font-semibold", !filter ? "border-brand bg-brand text-white" : "border-line bg-paper")}
        >
          Todos
        </Link>
        {board.challenges.map((c) => (
          <Link
            key={c.id}
            href={`${base}?challenge=${c.id}`}
            className={cn(
              "min-h-10 rounded-full border px-4 py-2 text-sm font-semibold",
              filter === c.id ? "border-brand bg-brand text-white" : "border-line bg-paper",
            )}
          >
            {c.startupName}
          </Link>
        ))}
      </nav>

      {board.teams.length === 0 && board.unassigned.length === 0 ? (
        <Card>
          <p className="text-muted">
            Todavía no hay equipos. Cuando cierres la inscripción, generá los equipos con las personas presentes.
          </p>
        </Card>
      ) : null}

      {visibleChallenges.map((c) => {
        const teams = board.teams.filter((t) => t.challengeId === c.id);
        if (teams.length === 0 && board.teams.length === 0 && !buildByHand) return null;
        return (
          <section key={c.id} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold">
                {c.startupName} <span className="font-normal text-muted">· {teams.length} equipo{teams.length === 1 ? "" : "s"}</span>
              </h2>
              {isAdmin ? <NewTeamButton eventId={event.id} challengeId={c.id} startupName={c.startupName} /> : null}
            </div>
            {teams.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {teams.map((t) => (
                  <TeamCard key={`${t.id}-${t.tableNumber}`} eventId={event.id} team={t} options={options} readOnly={!isAdmin} tableOwners={tableOwners} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">Sin equipos para este desafío.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
