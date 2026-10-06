"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";

export function EventTabs({ eventId, isAdmin }: { eventId: string; isAdmin: boolean }) {
  const pathname = usePathname();
  const base = `/staff/events/${eventId}`;
  const tabs = [
    { href: base, label: "Panel", match: (p: string) => p === base },
    { href: `${base}/teams`, label: "Equipos", match: (p: string) => p.startsWith(`${base}/teams`) },
    ...(isAdmin
      ? [{ href: `${base}/settings`, label: "Configuración", match: (p: string) => p.startsWith(`${base}/settings`) }]
      : []),
    { href: `${base}/print`, label: "Imprimir", match: (p: string) => p.startsWith(`${base}/print`) },
  ];
  return (
    <nav className="no-print -mx-4 overflow-x-auto px-4">
      <ul className="flex gap-2">
        {tabs.map((tab) => {
          const active = tab.match(pathname);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-xl px-4 font-semibold whitespace-nowrap",
                  active ? "bg-brand text-white" : "bg-paper text-ink border border-line hover:border-brand",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
