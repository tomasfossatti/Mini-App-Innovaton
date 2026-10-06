"use client";

import { useParams } from "next/navigation";
import { ErrorState } from "@/components/ui/ErrorState";

export default function ParticipantError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const params = useParams<{ eventSlug: string }>();
  return <ErrorState error={error} retry={retry} homeHref={params?.eventSlug ? `/e/${params.eventSlug}` : "/"} />;
}
