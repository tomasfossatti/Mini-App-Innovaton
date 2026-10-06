"use client";

import { useRouter } from "next/navigation";
import { startParticipationAction } from "@/actions/participant";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { useActionRunner } from "@/components/ui/useActionRunner";

export function StartButton({ eventSlug, label }: { eventSlug: string; label: string }) {
  const router = useRouter();
  const { run, pending, error } = useActionRunner();
  return (
    <div className="space-y-3">
      <Button
        pending={pending}
        pendingLabel="Un segundo…"
        onClick={async () => {
          const res = await run(() => startParticipationAction(eventSlug));
          if (res?.ok) router.push(res.data.next);
        }}
      >
        {label}
      </Button>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
