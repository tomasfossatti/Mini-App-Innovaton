import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { getDefaultEvent } from "@/lib/services/events";

export const dynamic = "force-dynamic";

/** La raíz redirige al evento activo: el QR puede apuntar a la URL corta. */
export default async function Home() {
  const event = await getDefaultEvent(getDb());
  if (event) redirect(`/e/${event.slug}`);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4">
      <h1 className="text-3xl font-extrabold">Innovatón · Espacio IDI + Educai</h1>
      <p className="text-muted">Todavía no hay un evento abierto.</p>
    </main>
  );
}
