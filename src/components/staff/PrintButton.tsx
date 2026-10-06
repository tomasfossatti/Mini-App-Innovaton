"use client";

import { Button } from "@/components/ui/Button";

export function PrintButton() {
  return (
    <Button size="md" onClick={() => window.print()} className="no-print">
      Imprimir
    </Button>
  );
}
