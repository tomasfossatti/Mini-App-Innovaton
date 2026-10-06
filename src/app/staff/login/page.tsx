import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/staff";
import { LoginForm } from "@/components/staff/LoginForm";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffLoginPage(props: PageProps<"/staff/login">) {
  const staff = await getCurrentStaff();
  if (staff) redirect("/staff");
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-10">
      <p className="text-sm font-semibold text-muted">Innovatón · Espacio IDI + Educai</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">Ingreso staff</h1>
      <Card className="mt-6">
        <LoginForm next={next} />
      </Card>
      <p className="mt-6 text-sm text-muted">
        Si no tenés cuenta, pedila a una persona ADMIN del evento.
      </p>
    </main>
  );
}
