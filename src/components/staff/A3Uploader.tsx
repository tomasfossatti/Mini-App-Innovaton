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
  // Si la subida falla, la foto comprimida queda en memoria para reintentar sin volver a sacarla.
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);

  async function upload(blob: Blob) {
    setError(null);
    setState("working");
    try {
      if (blob.size > MAX_BYTES) throw new Error("La foto pesa más de 4 MB incluso comprimida.");
      const body = new FormData();
      body.append("file", blob, "a3.jpg");
      const res = await fetch(`/api/staff/teams/${teamId}/artifacts`, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(45_000),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "No se pudo subir la foto.");
      setPendingBlob(null);
      setState("done");
      router.refresh();
    } catch (err) {
      setPendingBlob(blob);
      setState("idle");
      const timedOut = err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
      setError(
        timedOut
          ? "La subida tardó demasiado (señal débil). La foto quedó guardada acá: reintentá en un rato."
          : err instanceof Error
            ? err.message
            : "No se pudo subir la foto. Probá de nuevo.",
      );
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setState("working");
    const blob = await compress(file);
    if (input.current) input.current.value = "";
    await upload(blob);
  }

  return (
    <div className="space-y-2">
      <label className="inline-flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-brand px-6 text-lg font-semibold text-white sm:w-auto">
        {state === "working" ? <Spinner /> : null}
        {state === "working" ? "Subiendo foto…" : "Sacar o elegir foto del A3"}
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={state === "working"}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </label>
      {state === "done" ? <p className="text-sm font-semibold text-ok">Foto guardada.</p> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {pendingBlob && state !== "working" ? (
        <button
          type="button"
          onClick={() => void upload(pendingBlob)}
          className="min-h-12 rounded-2xl border-2 border-line bg-paper px-5 font-semibold"
        >
          Reintentar subida
        </button>
      ) : null}
    </div>
  );
}
