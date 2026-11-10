import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { LegacyPwaCleanup } from "@/components/platform/LegacyPwaCleanup";
import { ThemeScript } from "@/design/themeScript";
import { translateMessage } from "@/i18n";
import { requestLocale } from "@/i18n/requestLocale";
import { LanguageProvider } from "@/state/LanguageProvider";
import { PortsProvider } from "@/state/PortsProvider";
import { SessionProvider } from "@/state/SessionProvider";
import { ThemeProvider } from "@/state/ThemeProvider";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Stellarr",
    description: translateMessage(await requestLocale(), "app.description"),
    applicationName: "Stellarr",
    robots: { index: false, follow: false },
  };
}

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
 *
 * The language is resolved per request (see `requestLocale`), which is what
 * keeps every route out of static rendering. It goes to the client through
 * `<html lang>` and the provider, so both agree with the server's render.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await requestLocale();

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
