import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { opsApi, type OpsRole } from "@/lib/api";
import type { Perform } from "@/pages/users/use-access-actions";

/** The permission keys the server knows, shown as they are stored. */
const permissionKeys = [
  "manageServer",
  "manageChannels",
  "manageRoles",
  "manageMembers",
  "manageMessages",
  "moderateMembers",
  "manageBans",
  "viewAuditLog",
];

interface RoleFormProps {
  /** The role being edited, or null when a new one is created. */
  role: OpsRole | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  perform: Perform;
}

export function RoleForm({ role, open, onOpenChange, perform }: RoleFormProps) {
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const input = {
      name: String(values.get("name")),
      color: String(values.get("color")),
      permissions: permissionKeys.filter((key) => values.get(key) === "on"),
    };
    setPending(true);
    const saved = await perform(
      () => (role ? opsApi.updateRole(role.id, input) : opsApi.createRole(input)),
      role ? "Zaktualizowano rolę." : "Utworzono rolę.",
      "Nie udało się zapisać roli.",
    );
    setPending(false);
    if (saved) onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{role ? `Edytuj: ${role.name}` : "Nowa rola"}</SheetTitle>
          <SheetDescription>Nazwa, kolor i uprawnienia obowiązują na tym serwerze.</SheetDescription>
        </SheetHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-4 px-4">
          <div className="space-y-2">
            <Label htmlFor="role-name">Nazwa</Label>
            <Input
              id="role-name"
              name="name"
              required
              maxLength={64}
              defaultValue={role?.name ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-color">Kolor CSS</Label>
            <Input
              id="role-color"
              name="color"
              required
              maxLength={48}
              defaultValue={role?.color ?? "#64748b"}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Uprawnienia</legend>
            {permissionKeys.map((key) => (
              <label key={key} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <input
                  name={key}
                  type="checkbox"
                  defaultChecked={role?.permissions.includes(key) ?? false}
                />
                {key}
              </label>
            ))}
          </fieldset>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            {pending ? "Zapisywanie" : "Zapisz rolę"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
