import {
  Button,
  Dropdown,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Spinner,
} from "@stellarr/ui";
import { useState, type FormEvent } from "react";

import { t } from "@/i18n";
import { cockpitApi, type CockpitRole } from "@/lib/api";
import type { Perform } from "@/pages/users/use-access-actions";

/**
 * The characters the server accepts in a login: letters of any alphabet, decimal
 * digits, underscore, dot and hyphen.
 * The hyphen is escaped because browsers compile `pattern` with the `v` flag, which
 * rejects a bare one and then drops the whole pattern.
 */
const loginPattern = "[\\p{L}\\p{Nd}_.\\-]+";

/**
 * The role picker, a part of its own so that closing the sheet drops the choice
 * and the next account starts at the first role again. A role that is no longer
 * offered gives way to the first one rather than being submitted unseen.
 */
function RoleField({ roles }: { roles: CockpitRole[] }) {
  const [picked, setPicked] = useState("");
  const roleId = roles.some((role) => role.id === picked) ? picked : (roles[0]?.id ?? "");
  const options = roles.map((role) => ({ value: role.id, label: role.name }));

  return (
    <div className="space-y-2">
      <Label htmlFor="new-user-role">{t("common.role")}</Label>
      <Dropdown id="new-user-role" name="roleId" options={options} value={roleId} onChange={setPicked} />
    </div>
  );
}

interface UserFormProps {
  open: boolean;
  roles: CockpitRole[];
  onOpenChange: (open: boolean) => void;
  perform: Perform;
}

export function UserForm({ open, roles, onOpenChange, perform }: UserFormProps) {
  const [pending, setPending] = useState(false);
  const offered = roles.filter((role) => !role.isOwner);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email"));
    setPending(true);
    const created = await perform(
      () =>
        cockpitApi.createUser({
          username: String(values.get("username")),
          displayName: String(values.get("displayName")),
          ...(email && { email }),
          password: String(values.get("password")),
          roleId: String(values.get("roleId")),
        }),
      t("userForm.created"),
      t("userForm.createFailed"),
    );
    setPending(false);
    if (created) onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent closeLabel={t("common.close")} className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("userForm.title")}</SheetTitle>
          <SheetDescription>{t("userForm.description")}</SheetDescription>
        </SheetHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-4 px-4">
          <div className="space-y-2">
            <Label htmlFor="new-user-display-name">{t("userForm.displayName")}</Label>
            <Input id="new-user-display-name" name="displayName" required maxLength={64} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-user-username">{t("userForm.username")}</Label>
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
            <Label htmlFor="new-user-email">{t("userForm.email")}</Label>
            <Input id="new-user-email" name="email" type="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-user-password">{t("userForm.password")}</Label>
            <Input
              id="new-user-password"
              name="password"
              type="password"
              required
              minLength={8}
            />
          </div>
          <RoleField roles={offered} />
          {/* The dropdown's value travels in a hidden input, which `required` does
              not check, so without a role to offer the button is what stops the form. */}
          <Button type="submit" className="w-full" disabled={pending || offered.length === 0}>
            {pending ? <Spinner /> : null}
            {pending ? t("common.creating") : t("userForm.submit")}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
