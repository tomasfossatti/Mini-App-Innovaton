import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-3xl font-extrabold">No encontramos esta página</h1>
      <p className="text-muted">Revisá el link o escaneá de nuevo el QR del stand de Espacio IDI.</p>
      <Link href="/" className="min-h-11 content-center font-semibold text-brand underline underline-offset-4">
        Ir al inicio
      </Link>
    </main>
  );
}
