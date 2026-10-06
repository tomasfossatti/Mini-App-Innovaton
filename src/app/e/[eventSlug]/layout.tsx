import type { Metadata } from "next";

export const metadata: Metadata = { title: "Innovatón" };

export default function EventLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
