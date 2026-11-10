import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { LegacyPwaCleanup } from "@/components/platform/LegacyPwaCleanup";
import { ThemeScript } from "@/design/themeScript";
import { LanguageProvider, type InterfaceLocale } from "@/state/LanguageProvider";
import { PortsProvider } from "@/state/PortsProvider";
import { SessionProvider } from "@/state/SessionProvider";
import { ThemeProvider } from "@/state/ThemeProvider";

import "./globals.css";

export const metadata: Metadata = {
  title: "Stellarr",
  description: "Małe, samodzielnie hostowane miejsce na rozmowy.",
  applicationName: "Stellarr",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#111111",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Zooming to 200% is a WCAG requirement, so the scale is never locked.
  maximumScale: 5,
};

/**
 * A server component, so the static shell stays out of the client bundle and
 * `ThemeScript` can run before the first paint.
 *
 * Ports and the session wrap every route, /login included, because signing in
 * needs both. The app's own providers start further down, at `AppContainer`.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const storedLocale = (await cookies()).get("stellarr_locale")?.value;
  const locale: InterfaceLocale = storedLocale === "en" ? "en" : "pl";

  return (
    // ThemeScript writes data-theme, -scheme and -contrast onto <html> before
    // React hydrates, so the client can never match the server's bare element.
    // Those attributes belong to the script; the suppression covers this one
    // element and none of its children.
    <html lang={locale} data-locale={locale} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <LegacyPwaCleanup />
        <LanguageProvider initialLocale={locale}>
          <ThemeProvider>
            <PortsProvider>
              <SessionProvider>{children}</SessionProvider>
            </PortsProvider>
          </ThemeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
