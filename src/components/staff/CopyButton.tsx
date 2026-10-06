"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copiá el texto:", text);
        }
      }}
    >
      {copied ? "¡Copiado!" : label}
    </Button>
  );
}
