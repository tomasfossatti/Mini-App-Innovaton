import { requireStaffPage } from "@/lib/auth/staff";
import { StaffHeader } from "@/components/staff/StaffHeader";

export default async function StaffAppLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaffPage();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <StaffHeader staff={staff} />
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-5">{children}</div>
    </div>
  );
}
