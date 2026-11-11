import { ChevronDown, Menu } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import logoForDark from "@/assets/logo/small.svg";
import logoForLight from "@/assets/logo/mono.svg";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { UserAvatar } from "@/components/user-avatar";
import { t, type MessageKey } from "@/i18n";
import type { OpsOperator } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useOps } from "@/state/ops-context";

interface NavigationItem {
  labelKey: MessageKey;
  href: string;
}

const navigation: readonly NavigationItem[] = [
  { labelKey: "nav.overview", href: "/" },
  { labelKey: "nav.users", href: "/users" },
  { labelKey: "nav.runtime", href: "/runtime" },
  { labelKey: "nav.logs", href: "/logs" },
  { labelKey: "nav.backups", href: "/backups" },
  { labelKey: "nav.releases", href: "/desktop-release" },
  { labelKey: "nav.settings", href: "/settings" },
];

/** The root only matches itself; every other item also owns the pages beneath it. */
function activeItem(pathname: string): NavigationItem | undefined {
  return navigation.find((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );
}

/** A list of text links, as in the documentation's sidebar: the current page takes the link colour. */
function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label={t("shell.navigationLabel")} className="flex flex-col px-6 py-4">
      {navigation.map(({ labelKey, href }) => (
        <NavLink
          key={href}
          to={href}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex h-9 items-center rounded-sm text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              isActive && "text-sidebar-primary hover:text-sidebar-primary",
            )
          }
        >
          {t(labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * The mark and the wordmark, as the documentation shows them: the one-colour
 * mark on light, the small mark on dark. The gap is the height of the mark's
 * shortest bar, as the brand guidelines ask.
 */
function Brand() {
  return (
    <div className="flex h-16 items-center gap-1.5 px-6">
      <img src={logoForLight} alt="" className="size-6 dark:hidden" />
      <img src={logoForDark} alt="" className="hidden size-6 dark:block" />
      <p className="truncate text-base font-semibold">{t("app.name")}</p>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <Brand />
      <div className="mx-6 border-t border-sidebar-border" />
      <NavigationLinks onNavigate={onNavigate} />
    </div>
  );
}

function OperatorMenu({ operator, onLogout }: { operator: OpsOperator; onLogout: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2">
          <UserAvatar displayName={operator.displayName} className="size-7" />
          <span className="hidden text-sm sm:inline">{operator.displayName.split(" ")[0]}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block">{operator.displayName}</span>
          <span className="block text-xs font-normal text-muted-foreground">@{operator.username}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          {/* A plain anchor: the app lives at the site root, outside this panel's /ops/ router base. */}
          <a href="/">{t("shell.openApp")}</a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onLogout}>{t("shell.logout")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  const { bootstrap, logout } = useOps();
  if (!bootstrap) return null;
  const { instance, operator } = bootstrap;
  const item = activeItem(pathname);

  return (
    <div className="min-h-svh bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-68 lg:block">
        <Sidebar />
      </aside>

      <div className="lg:pl-68">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background px-4 sm:px-8">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-ml-2 lg:hidden"
                aria-label={t("shell.openNavigation")}
              >
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-68 gap-0 border-r-0 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>{t("shell.navigationTitle")}</SheetTitle>
                <SheetDescription>{t("shell.navigationDescription")}</SheetDescription>
              </SheetHeader>
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{item ? t(item.labelKey) : t("app.name")}</p>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">{instance.name}</p>
          </div>

          <OperatorMenu operator={operator} onLogout={() => void logout()} />
        </header>

        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
