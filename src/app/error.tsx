"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorState error={error} retry={retry} homeHref="/" />;
}
