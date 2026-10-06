"use client";

import { useState } from "react";
import { communityCtaAction } from "@/actions/participant";
import { IDI_CTA } from "@/lib/domain/copy";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { useActionRunner } from "@/components/ui/useActionRunner";

export function CommunityCta({
  eventSlug,
  done: initialDone,
  communityUrl,
}: {
  eventSlug: string;
  done: boolean;
  communityUrl: string | null;
}) {
  const [done, setDone] = useState(initialDone);
  const { run, pending, error } = useActionRunner();
  return (
    <section className="space-y-4 rounded-3xl bg-brand p-6 text-white">
      <p className="text-lg leading-snug">{IDI_CTA.body1}</p>
      <p className="text-lg font-semibold leading-snug">{IDI_CTA.body2}</p>
      {done ? (
        <div className="space-y-3">
          <p className="rounded-2xl bg-white/15 p-4 text-base font-semibold" role="status">
            ¡Listo! Te vamos a avisar de los próximos desafíos de Espacio IDI.
          </p>
          {communityUrl ? (
            <a
              href={communityUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-white px-6 text-lg font-semibold text-brand"
            >
              Sumarme a la comunidad
            </a>
          ) : null}
        </div>
      ) : (
        <Button
          variant="accent"
          pending={pending}
          pendingLabel="Guardando…"
          onClick={async () => {
            const res = await run(() => communityCtaAction(eventSlug));
            if (res?.ok) setDone(true);
          }}
        >
          {IDI_CTA.button}
        </Button>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </section>
  );
}
