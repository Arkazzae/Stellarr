import {
  ChevronDown,
  Cpu,
  DatabaseBackup,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageOpen,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
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
  icon: LucideIcon;
}

const navigation: readonly NavigationItem[] = [
  { labelKey: "nav.overview", href: "/", icon: LayoutDashboard },
  { labelKey: "nav.users", href: "/users", icon: UsersRound },
  { labelKey: "nav.runtime", href: "/runtime", icon: Cpu },
  { labelKey: "nav.logs", href: "/logs", icon: ScrollText },
  { labelKey: "nav.backups", href: "/backups", icon: DatabaseBackup },
  { labelKey: "nav.releases", href: "/desktop-release", icon: PackageOpen },
  { labelKey: "nav.settings", href: "/settings", icon: Settings },
];

/** The root only matches itself; every other item also owns the pages beneath it. */
function activeItem(pathname: string): NavigationItem | undefined {
  return navigation.find((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );
}

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label={t("shell.navigationLabel")} className="flex flex-1 flex-col gap-1 p-3">
      {navigation.map(({ labelKey, href, icon: Icon }) => (
        <NavLink
          key={href}
          to={href}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
            )
          }
        >
          <Icon className="size-4" aria-hidden="true" />
          {t(labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex h-16 items-center gap-3 px-5">
      <div className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
        <ShieldCheck className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{t("app.name")}</p>
        <p className="truncate text-xs text-muted-foreground">{t("shell.role")}</p>
      </div>
    </div>
  );
}

function InstanceFooter({ instanceName }: { instanceName: string }) {
  return (
    <div className="p-3">
      <Separator className="mb-3" />
      <div className="flex items-center gap-3 rounded-md px-3 py-2">
        <div className="grid size-8 shrink-0 place-items-center rounded-md border bg-background">
          <Server className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{instanceName}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
            {t("shell.localInstance")}
          </p>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ instanceName, onNavigate }: { instanceName: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <Brand />
      <Separator />
      <NavigationLinks onNavigate={onNavigate} />
      <InstanceFooter instanceName={instanceName} />
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
          <a href="/">
            <Settings aria-hidden="true" />
            {t("shell.openApp")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onLogout}>
          <LogOut aria-hidden="true" />
          {t("shell.logout")}
        </DropdownMenuItem>
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
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r lg:block">
        <Sidebar instanceName={instance.name} />
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/95 px-4 supports-[backdrop-filter]:bg-background/85 supports-[backdrop-filter]:backdrop-blur-sm sm:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="lg:hidden"
                aria-label={t("shell.openNavigation")}
              >
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 gap-0 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>{t("shell.navigationTitle")}</SheetTitle>
                <SheetDescription>{t("shell.navigationDescription")}</SheetDescription>
              </SheetHeader>
              <Sidebar instanceName={instance.name} onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{item ? t(item.labelKey) : t("app.name")}</p>
            <p className="hidden text-xs text-muted-foreground sm:block">{instance.name}</p>
          </div>

          <Badge variant="outline" className="hidden sm:inline-flex">
            {t("shell.ownerBadge")}
          </Badge>
          <OperatorMenu operator={operator} onLogout={() => void logout()} />
        </header>

        <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
