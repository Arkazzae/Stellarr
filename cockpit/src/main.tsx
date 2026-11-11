import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { AppGate } from "@/components/app-gate";
import { TooltipProvider } from "@/components/ui/tooltip";
import { detectLocale, setLocale } from "@/i18n";
import { BackupsPage } from "@/pages/backups-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { IntegrationsPage } from "@/pages/integrations-page";
import { LogsPage } from "@/pages/logs-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { RuntimePage } from "@/pages/runtime-page";
import { ServersPage } from "@/pages/servers-page";
import { SettingsPage } from "@/pages/settings-page";
import { UsersPage } from "@/pages/users-page";
import { CockpitProvider } from "@/state/cockpit-provider";
import { LocaleProvider } from "@/state/locale-provider";

import "./index.css";

const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <AppGate />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: "users", element: <UsersPage /> },
        { path: "servers", element: <ServersPage /> },
        { path: "runtime", element: <RuntimePage /> },
        { path: "logs", element: <LogsPage /> },
        { path: "backups", element: <BackupsPage /> },
        { path: "integrations", element: <IntegrationsPage /> },
        { path: "settings", element: <SettingsPage /> },
        { path: "*", element: <NotFoundPage /> },
      ],
    },
  ],
  // nginx serves the build under /cockpit/; the router wants the prefix without its trailing slash.
  { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" },
);

// The language is set before anything renders: the one chosen in Settings, else English.
setLocale(detectLocale());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CockpitProvider>
      <TooltipProvider>
        <LocaleProvider>
          <RouterProvider router={router} />
        </LocaleProvider>
      </TooltipProvider>
    </CockpitProvider>
  </StrictMode>,
);
