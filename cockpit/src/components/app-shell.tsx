import {
  Button,
  cx,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@stellarr/ui";
import { Fragment, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { BrandMark } from "@/components/brand-mark";
import { FreshSecondStepDialog } from "@/components/fresh-second-step-dialog";
import { Icon, type IconName } from "@/components/icons/icon";
import { UserAvatar } from "@/components/user-avatar";
import { t, type MessageKey } from "@/i18n";
import type { CockpitOperator } from "@/lib/api";
import { useCockpit } from "@/state/cockpit-context";

const DOCUMENTATION_URL = "https://arkazzae.github.io/Stellarr/";

interface NavigationItem {
  labelKey: MessageKey;
  href: string;
  icon: IconName;
}

interface NavigationGroup {
  /** The first group sits under the brand without a label. */
  labelKey?: MessageKey;
  items: readonly NavigationItem[];
}

const navigation: readonly NavigationGroup[] = [
  { items: [{ labelKey: "nav.overview", href: "/", icon: "apps" }] },
  {
    labelKey: "nav.group.community",
    items: [
      { labelKey: "nav.users", href: "/users", icon: "users" },
      { labelKey: "nav.servers", href: "/servers", icon: "server" },
    ],
  },
  {
    labelKey: "nav.group.system",
    items: [
      { labelKey: "nav.runtime", href: "/runtime", icon: "cpu" },
      { labelKey: "nav.logs", href: "/logs", icon: "list" },
      { labelKey: "nav.backups", href: "/backups", icon: "folder" },
    ],
  },
  {
    labelKey: "nav.group.configuration",
    items: [
      { labelKey: "nav.integrations", href: "/integrations", icon: "link" },
      { labelKey: "nav.settings", href: "/settings", icon: "gear" },
    ],
  },
];

const navigationItems = navigation.flatMap((group) => group.items);

/** The root only matches itself; every other item also owns the pages beneath it. */
function activeItem(pathname: string): NavigationItem | undefined {
  return navigationItems.find((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );
}

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label={t("shell.navigationLabel")} className="flex flex-1 flex-col overflow-y-auto px-3 pb-4">
      {navigation.map((group, index) => (
        <Fragment key={group.labelKey ?? index}>
          {group.labelKey ? (
            <p className="px-3 pt-5 pb-1.5 text-xs font-medium text-muted-foreground">{t(group.labelKey)}</p>
          ) : null}
          {group.items.map(({ labelKey, href, icon }) => (
            <NavLink
              key={href}
              to={href}
              onClick={onNavigate}
              className={({ isActive }) =>
                cx(
                  "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  isActive ? "bg-sidebar-accent text-sidebar-foreground" : "text-muted-foreground",
                )
              }
            >
              <Icon name={icon} size={18} />
              {t(labelKey)}
            </NavLink>
          ))}
        </Fragment>
      ))}
    </nav>
  );
}

/**
 * The one-colour mark in the text colour, and the wordmark. The gap is the
 * height of the mark's shortest bar, as the brand guidelines ask.
 */
function Brand() {
  return (
    <div className="flex h-16 shrink-0 items-center gap-1.5 px-6">
      <BrandMark className="size-6" />
      <p className="truncate text-base font-semibold">{t("app.name")}</p>
    </div>
  );
}

function OperatorMenu({ operator, onLogout }: { operator: CockpitOperator; onLogout: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg border bg-background p-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <UserAvatar displayName={operator.displayName} className="size-8" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{operator.displayName}</span>
            <span className="block truncate text-xs text-muted-foreground">@{operator.username}</span>
          </span>
          <Icon name="caret" size={14} className="text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel>
          <span className="block">{operator.displayName}</span>
          <span className="block text-xs font-normal text-muted-foreground">@{operator.username}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          {/* A plain anchor: the app lives at the site root, outside this panel's /cockpit/ router base. */}
          <a href="/">{t("shell.openApp")}</a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onLogout}>
          <Icon name="signout" />
          {t("shell.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Sidebar({ operator, onLogout, onNavigate }: { operator: CockpitOperator; onLogout: () => void; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <Brand />
      <NavigationLinks onNavigate={onNavigate} />
      <div className="shrink-0 p-3">
        <OperatorMenu operator={operator} onLogout={onLogout} />
      </div>
    </div>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  const { bootstrap, logout } = useCockpit();
  if (!bootstrap) return null;
  const { instance, operator } = bootstrap;
  const item = activeItem(pathname);
  const onLogout = () => void logout();

  return (
    // The window never scrolls: the bar stays, and the page scrolls in its own areas.
    <div className="relative h-svh overflow-hidden bg-sidebar">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-68 lg:block">
        <Sidebar operator={operator} onLogout={onLogout} />
      </aside>

      {/* On wide screens the page sits in an inset panel beside the sidebar. */}
      <div className="flex h-full flex-col lg:py-2 lg:pr-2 lg:pl-68">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background lg:rounded-xl lg:border">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4 sm:px-6">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="quiet"
                  size="icon"
                  className="-ml-2 lg:hidden"
                  aria-label={t("shell.openNavigation")}
                >
                  <Icon name="sidebar" size={18} />
                </Button>
              </SheetTrigger>
              <SheetContent closeLabel={t("common.close")} side="left" className="w-68 gap-0 border-r-0 p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>{t("shell.navigationTitle")}</SheetTitle>
                  <SheetDescription>{t("shell.navigationDescription")}</SheetDescription>
                </SheetHeader>
                <Sidebar operator={operator} onLogout={onLogout} onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>

            <p className="flex min-w-0 flex-1 items-center gap-2 text-sm">
              <span className="hidden truncate text-muted-foreground sm:inline">{instance.name}</span>
              <span className="hidden text-faint sm:inline" aria-hidden="true">
                /
              </span>
              <span className="truncate font-medium">{item ? t(item.labelKey) : t("app.name")}</span>
            </p>

            <a
              href={DOCUMENTATION_URL}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("shell.documentation")}
            </a>
          </header>

          {/* Pages fill this area and scroll inside their own lists; it scrolls
              itself only when a page cannot shrink to fit. */}
          <main className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="mx-auto flex min-h-0 w-full max-w-[87.5rem] flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
              <Outlet />
              <FreshSecondStepDialog />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
