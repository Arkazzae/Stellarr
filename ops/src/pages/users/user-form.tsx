import { LoaderCircle, Plus } from "lucide-react";
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

/**
 * The characters the server accepts in a login: letters of any alphabet, decimal
 * digits, underscore, dot and hyphen.
 * The hyphen is escaped because browsers compile `pattern` with the `v` flag, which
 * rejects a bare one and then drops the whole pattern.
 */
const loginPattern = "[\\p{L}\\p{Nd}_.\\-]+";

interface UserFormProps {
  open: boolean;
  roles: OpsRole[];
  onOpenChange: (open: boolean) => void;
  perform: Perform;
}

export function UserForm({ open, roles, onOpenChange, perform }: UserFormProps) {
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email"));
    setPending(true);
    const created = await perform(
      () =>
        opsApi.createUser({
          username: String(values.get("username")),
          displayName: String(values.get("displayName")),
          ...(email && { email }),
          password: String(values.get("password")),
          roleId: String(values.get("roleId")),
        }),
      "Utworzono konto użytkownika.",
      "Nie udało się utworzyć konta.",
    );
    setPending(false);
    if (created) onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Nowy użytkownik</SheetTitle>
          <SheetDescription>
            Konto zostanie od razu dodane do instancji z wybraną rolą.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-4 px-4">
          <div className="space-y-2">
            <Label htmlFor="new-user-display-name">Nazwa wyświetlana</Label>
            <Input id="new-user-display-name" name="displayName" required maxLength={64} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-user-username">Login</Label>
            <Input
              id="new-user-username"
              name="username"
              required
              minLength={2}
              maxLength={32}
              pattern={loginPattern}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-user-email">E-mail (opcjonalnie)</Label>
            <Input id="new-user-email" name="email" type="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-user-password">Hasło tymczasowe</Label>
            <Input
              id="new-user-password"
              name="password"
              type="password"
              required
              minLength={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-user-role">Rola</Label>
            <select
              id="new-user-role"
              name="roleId"
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {roles
                .filter((role) => !role.isOwner)
                .map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
            </select>
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            {pending ? "Tworzenie" : "Utwórz konto"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
