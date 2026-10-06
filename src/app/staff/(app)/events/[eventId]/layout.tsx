import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/staff";
import { getDb } from "@/lib/db/client";
import { formatDate } from "@/lib/domain/time";
import { getEventById } from "@/lib/services/events";
import { EventTabs } from "@/components/staff/EventTabs";
import { PHASE_LABELS } from "@/components/staff/phase";
import { Badge } from "@/components/ui/Badge";

export default async function StaffEventLayout(props: LayoutProps<"/staff/events/[eventId]">) {
  const staff = await requireStaffPage();
  const { eventId } = await props.params;
  const event = await getEventById(getDb(), eventId);
  if (!event) notFound();
  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{event.name}</h1>
        <Badge tone="brand">{PHASE_LABELS[event.phase]}</Badge>
        <span className="text-sm text-muted">
          {formatDate(event.startsAt, event.timezone)} · /e/{event.slug}
        </span>
      </div>
      <EventTabs eventId={event.id} isAdmin={staff.role === "ADMIN"} />
      {props.children}
    </div>
  );
}
