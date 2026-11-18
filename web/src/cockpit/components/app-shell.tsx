import { Link, usePathname } from "@stellarr/router";
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
import { Fragment, useState, type ReactNode } from "react";

import { BrandMark } from "./brand-mark";
import { FreshSecondStepDialog } from "./fresh-second-step-dialog";
import { Icon, type IconName } from "./icons/icon";
import { UserAvatar } from "./user-avatar";
import { t, type MessageKey } from "../i18n";
import type { CockpitOperator } from "../lib/api";
import { COCKPIT_ROOT, cockpitHref } from "../lib/paths";
import { useCockpit } from "../state/cockpit-context";

const DOCUMENTATION_URL = "https://docs.stellarr.online/";

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
  { items: [{ labelKey: "nav.overview", href: cockpitHref("/"), icon: "apps" }] },
  {
    labelKey: "nav.group.community",
    items: [
      { labelKey: "nav.users", href: cockpitHref("/users"), icon: "users" },
      { labelKey: "nav.servers", href: cockpitHref("/servers"), icon: "server" },
    ],
  },
  {
    labelKey: "nav.group.system",
    items: [
      { labelKey: "nav.runtime", href: cockpitHref("/runtime"), icon: "cpu" },
      { labelKey: "nav.logs", href: cockpitHref("/logs"), icon: "list" },
      { labelKey: "nav.backups", href: cockpitHref("/backups"), icon: "folder" },
    ],
  },
  {
    labelKey: "nav.group.configuration",
    items: [
      { labelKey: "nav.integrations", href: cockpitHref("/integrations"), icon: "link" },
      { labelKey: "nav.settings", href: cockpitHref("/settings"), icon: "gear" },
    ],
  },
];

const navigationItems = navigation.flatMap((group) => group.items);

/** The overview only matches itself; every other item also owns the pages beneath it. */
function activeItem(pathname: string): NavigationItem | undefined {
  return navigationItems.find((item) =>
    item.href === COCKPIT_ROOT
      ? pathname === COCKPIT_ROOT
      : pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  const active = activeItem(usePathname());

  return (
    <nav aria-label={t("shell.navigationLabel")} className="flex flex-1 flex-col overflow-y-auto px-3 pb-4">
      {navigation.map((group, index) => (
        <Fragment key={group.labelKey ?? index}>
          {group.labelKey ? (
            <p className="px-3 pt-5 pb-1.5 text-xs font-medium text-muted-foreground">{t(group.labelKey)}</p>
          ) : null}
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={item === active ? "page" : undefined}
              className={cx(
                "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                item === active ? "bg-sidebar-accent text-sidebar-foreground" : "text-muted-foreground",
              )}
            >
              <Icon name={item.icon} size={18} />
              {t(item.labelKey)}
            </Link>
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
          {/* The web client is a document of its own, so this loads it as a new page. */}
          <Link href="/">{t("shell.openApp")}</Link>
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

/** The panel around a page: the sidebar, the header that names the page, and the page itself. */
export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
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
              {children}
              <FreshSecondStepDialog />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
