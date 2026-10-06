"use client";

import { deleteChallengeAction } from "@/actions/admin";
import { Button } from "@/components/ui/Button";
import { useActionRunner } from "@/components/ui/useActionRunner";

export function DeleteChallengeButton({ eventId, challengeId }: { eventId: string; challengeId: string }) {
  const { run, pending, error } = useActionRunner();
  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        size="sm"
        pending={pending}
        onClick={() => {
          if (confirm("¿Borrar este desafío? Solo es posible si nadie lo eligió.")) {
            void run(() => deleteChallengeAction(eventId, challengeId));
          }
        }}
      >
        Borrar
      </Button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
