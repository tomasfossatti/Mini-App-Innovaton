"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";

const MAX_SIDE = 1600;
const MAX_BYTES = 4 * 1024 * 1024;

/** Comprime en el navegador para que la subida funcione con mala conexión. */
async function compress(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.55]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    return file;
  } catch {
    return file;
  }
}

export function A3Uploader({ teamId }: { teamId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setState("working");
    try {
      const blob = await compress(file);
      if (blob.size > MAX_BYTES) throw new Error("La foto pesa más de 4 MB incluso comprimida.");
      const body = new FormData();
      body.append("file", blob, "a3.jpg");
      const res = await fetch(`/api/staff/teams/${teamId}/artifacts`, { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "No se pudo subir la foto.");
      setState("done");
      router.refresh();
    } catch (err) {
      setState("idle");
      setError(err instanceof Error ? err.message : "No se pudo subir la foto. Probá de nuevo.");
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <label className="inline-flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-brand px-6 text-lg font-semibold text-white sm:w-auto">
        {state === "working" ? <Spinner /> : null}
        {state === "working" ? "Subiendo foto…" : "Sacar / subir foto del A3"}
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={state === "working"}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </label>
      {state === "done" ? <p className="text-sm font-semibold text-ok">Foto guardada.</p> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
