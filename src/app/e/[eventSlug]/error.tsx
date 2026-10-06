"use client";

import { useParams } from "next/navigation";
import { ErrorState } from "@/components/ui/ErrorState";

export default function ParticipantError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const params = useParams<{ eventSlug: string }>();
  return <ErrorState error={error} reset={reset} homeHref={params?.eventSlug ? `/e/${params.eventSlug}` : "/"} />;
}
