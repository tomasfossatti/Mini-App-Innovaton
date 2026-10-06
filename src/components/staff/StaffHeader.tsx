import Link from "next/link";
import { logoutAction } from "@/actions/staff-auth";
import type { StaffIdentity } from "@/lib/services/staff";

export function StaffHeader({ staff }: { staff: StaffIdentity }) {
  return (
    <header className="no-print border-b border-line bg-paper">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
        <Link href="/staff" className="font-bold tracking-tight">
          Innovatón · Staff
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {staff.role === "ADMIN" ? (
            <Link href="/staff/members" className="font-medium text-brand hover:underline">
              Cuentas
            </Link>
          ) : null}
          <span className="hidden text-muted sm:inline">
            {staff.name} · {staff.role}
          </span>
          <form action={logoutAction}>
            <button type="submit" className="min-h-10 rounded-xl border border-line px-3 font-medium hover:border-brand">
              Salir
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
