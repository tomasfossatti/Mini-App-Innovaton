import type { Metadata } from "next";
import { requireStaffPage } from "@/lib/auth/staff";
import { getDb } from "@/lib/db/client";
import { listStaffMembers } from "@/lib/services/staff";
import { CreateStaffForm, StaffList } from "@/components/staff/StaffMembersClient";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Cuentas de staff" };

export default async function StaffMembersPage() {
  const staff = await requireStaffPage("ADMIN");
  const members = await listStaffMembers(getDb());
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Cuentas de staff</h1>
      <Card>
        <StaffList members={members} currentId={staff.id} />
      </Card>
      <Card>
        <h2 className="mb-4 text-lg font-bold">Nueva cuenta</h2>
        <CreateStaffForm />
        <p className="mt-3 text-sm text-muted">
          Los founders pueden evaluar a sus equipos con una cuenta STAFF desde la pestaña Equipos.
        </p>
      </Card>
    </div>
  );
}
