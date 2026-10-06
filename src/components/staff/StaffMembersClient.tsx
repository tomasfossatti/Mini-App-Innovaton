"use client";

import { useActionState } from "react";
import { createStaffAction, resetStaffPasswordAction, setStaffActiveAction } from "@/actions/admin";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Select, TextInput } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useActionRunner } from "@/components/ui/useActionRunner";

export interface StaffListItem {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "STAFF";
  active: boolean;
}

export function CreateStaffForm() {
  const [state, formAction] = useActionState(createStaffAction, null);
  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="Nombre" htmlFor="st-name">
        <TextInput id="st-name" name="name" required />
      </Field>
      <Field label="Email" htmlFor="st-email">
        <TextInput id="st-email" name="email" type="email" required />
      </Field>
      <Field label="Contraseña inicial" htmlFor="st-pass" hint="Mínimo 8 caracteres. Compartila por un canal privado.">
        <TextInput id="st-pass" name="password" type="text" minLength={8} required />
      </Field>
      <Field label="Rol" htmlFor="st-role" hint="STAFF opera el evento. ADMIN además configura eventos, desafíos y cuentas.">
        <Select id="st-role" name="role" defaultValue="STAFF">
          <option value="STAFF">STAFF (staff, facilitadores, founders)</option>
          <option value="ADMIN">ADMIN</option>
        </Select>
      </Field>
      <div className="space-y-3 sm:col-span-2">
        {state && !state.ok ? <Notice tone="error">{state.error}</Notice> : null}
        {state && state.ok ? <Notice tone="success">Cuenta creada.</Notice> : null}
        <SubmitButton size="md" pendingLabel="Creando…">
          Crear cuenta
        </SubmitButton>
      </div>
    </form>
  );
}

function ResetPasswordForm({ staffId }: { staffId: string }) {
  const [state, formAction] = useActionState(resetStaffPasswordAction.bind(null, staffId), null);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <TextInput name="password" type="text" minLength={8} required placeholder="Nueva contraseña" className="max-w-56 py-2 text-base" />
      <SubmitButton size="sm" variant="secondary">
        Cambiar
      </SubmitButton>
      {state && !state.ok ? <span className="text-sm text-danger">{state.error}</span> : null}
      {state && state.ok ? <span className="text-sm text-ok">Contraseña actualizada.</span> : null}
    </form>
  );
}

function ToggleActive({ member }: { member: StaffListItem }) {
  const { run, pending, error } = useActionRunner();
  return (
    <div>
      <Button
        size="sm"
        variant="secondary"
        pending={pending}
        onClick={() => void run(() => setStaffActiveAction(member.id, !member.active))}
      >
        {member.active ? "Desactivar" : "Activar"}
      </Button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}

export function StaffList({ members, currentId }: { members: StaffListItem[]; currentId: string }) {
  return (
    <ul className="divide-y divide-line">
      {members.map((m) => (
        <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div>
            <p className="font-semibold">
              {m.name} {m.id === currentId ? <span className="text-sm text-muted">(vos)</span> : null}
            </p>
            <p className="text-sm text-muted">{m.email}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={m.role === "ADMIN" ? "accent" : "neutral"}>{m.role}</Badge>
            {!m.active ? <Badge tone="danger">Inactiva</Badge> : null}
            {m.id !== currentId ? <ToggleActive member={m} /> : null}
          </div>
          <details className="w-full">
            <summary className="cursor-pointer text-sm font-medium text-brand">Cambiar contraseña</summary>
            <div className="mt-2">
              <ResetPasswordForm staffId={m.id} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
