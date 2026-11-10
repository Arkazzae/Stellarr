import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { AppGate } from "@/components/app-gate";
import { TooltipProvider } from "@/components/ui/tooltip";
import { detectLocale, setLocale } from "@/i18n";
import { BackupsPage } from "@/pages/backups-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { DesktopReleasePage } from "@/pages/desktop-release-page";
import { LogsPage } from "@/pages/logs-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { RuntimePage } from "@/pages/runtime-page";
import { SettingsPage } from "@/pages/settings-page";
import { UsersPage } from "@/pages/users-page";
import { OpsProvider } from "@/state/ops-provider";

import "./index.css";

const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <AppGate />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: "users", element: <UsersPage /> },
        { path: "runtime", element: <RuntimePage /> },
        { path: "logs", element: <LogsPage /> },
        { path: "backups", element: <BackupsPage /> },
        { path: "desktop-release", element: <DesktopReleasePage /> },
        { path: "settings", element: <SettingsPage /> },
        { path: "*", element: <NotFoundPage /> },
      ],
    },
  ],
  // nginx serves the build under /ops/; the router wants the prefix without its trailing slash.
  { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" },
);

// The language is decided once, before anything renders: the web client's cookie, then the browser.
setLocale(detectLocale());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OpsProvider>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </OpsProvider>
  </StrictMode>,
);
