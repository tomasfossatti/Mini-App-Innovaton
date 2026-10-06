"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { savePreClarityAction } from "@/actions/participant";
import { Scale } from "@/components/ui/Scale";
import { Spinner } from "@/components/ui/Spinner";
import { ActionError } from "@/components/ui/ActionError";
import { useActionRunner } from "@/components/ui/useActionRunner";

export function ClarityStep({ eventSlug, initial }: { eventSlug: string; initial: number | null }) {
  const router = useRouter();
  const [value, setValue] = useState<number | null>(initial);
  const { run, pending, error, needsReload } = useActionRunner();

  async function choose(v: number) {
    setValue(v);
    const res = await run(() => savePreClarityAction(eventSlug, v));
    if (res?.ok) router.push(res.data.next);
  }

  return (
    <div className="space-y-4">
      <Scale name="Claridad sobre tu aporte" value={value} onChange={choose} minLabel="Nada claro" maxLabel="Muy claro" disabled={pending} />
      {pending ? (
        <p className="flex items-center gap-2 text-muted" role="status">
          <Spinner className="size-4" /> Guardando…
        </p>
      ) : null}
      <ActionError error={error} needsReload={needsReload} />
    </div>
  );
}
