import type { Mode } from "@/lib/domain/constants";
import { MODE_LABELS } from "@/lib/domain/copy";
import { cn } from "@/components/ui/cn";

const MODE_CLASSES: Record<Mode, string> = {
  EXPLORE: "bg-explore",
  CREATE: "bg-create",
  DRIVE: "bg-drive",
};

export function ModeBadge({ mode, className }: { mode: Mode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-4 py-1.5 text-lg font-extrabold uppercase tracking-wide text-white",
        MODE_CLASSES[mode],
        className,
      )}
    >
      {MODE_LABELS[mode]}
    </span>
  );
}
