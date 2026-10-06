"use client";

import { createTeamAction } from "@/actions/staff";
import { Button } from "@/components/ui/Button";
import { useActionRunner } from "@/components/ui/useActionRunner";

export function NewTeamButton({ eventId, challengeId, startupName }: { eventId: string; challengeId: string; startupName: string }) {
  const { run, pending, error } = useActionRunner();
  return (
    <div>
      <Button
        size="sm"
        variant="secondary"
        pending={pending}
        onClick={() => {
          if (confirm(`¿Crear un equipo vacío de ${startupName}? Va a tomar la siguiente mesa libre.`)) {
            void run(() => createTeamAction(eventId, challengeId));
          }
        }}
      >
        + Equipo vacío
      </Button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
