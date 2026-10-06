import { getDb } from "@/lib/db/client";
import { MODE_LABELS, MODE_RESULT } from "@/lib/domain/copy";
import { formatDate, formatTime } from "@/lib/domain/time";
import { googleCalendarLink, icsPath } from "@/lib/event-calendar";
import { getParticipantState } from "@/lib/services/participation";
import { loadParticipantStep } from "@/lib/participant-page";
import { ParticipantShell } from "@/components/participant/ParticipantShell";
import { StatusView } from "@/components/participant/StatusView";

export default async function StatusPage(props: PageProps<"/e/[eventSlug]/status">) {
  const { eventSlug } = await props.params;
  const { event, participation } = await loadParticipantStep(eventSlug, "status");
  const state = await getParticipantState(getDb(), event, participation);
  const tz = event.timezone;
  const mode = participation.initialMode;
  return (
    <ParticipantShell eventName={event.name}>
      <StatusView
        eventSlug={event.slug}
        initialState={state}
        mission={mode ? { label: MODE_LABELS[mode], text: MODE_RESULT[mode].mission } : null}
        info={{
          checkinTime: formatTime(event.checkinOpensAt, tz),
          closeTime: formatTime(event.registrationClosesAt, tz),
          startTime: formatTime(event.startsAt, tz),
          dateLabel: formatDate(event.startsAt, tz),
          location: event.locationLabel,
          googleCalendarUrl: googleCalendarLink(event),
          icsUrl: icsPath(event),
        }}
      />
    </ParticipantShell>
  );
}
