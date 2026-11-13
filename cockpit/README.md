# Stellarr Cockpit

Stellarr Cockpit is the instance operator panel (`cockpit/`), built as a standalone React + Vite single-page application. It provides:

- **Overview**: headline metrics with 7-day trends and week-over-week change, 30-day activity across six series, API uptime, the last hour of API and database availability, request and connection charts, and service health status (auto-refreshed every 30 s).
- **Users**: account management, active sessions, and built-in roles.
- **Servers**: list of servers on the instance with ownership transfer and deletion.
- **Runtime**: 60-minute process telemetry (requests, errors, CPU, memory, connections, database latency) and per-minute availability across all container services.
- **Logs**: paged, searchable, and filterable 10,000-line in-memory log stream with TSV export.
- **Backups**: background database snapshots or full `.zip` archives (database, object store, data-protection keys, and instance files) with manifest verification and retention pruning.
- **Integrations**: Resend mail delivery, GIPHY GIF search, and the optional Cloudflare R2 backup destination, with key checks.
- **Settings**: instance name, time zone, retention windows, SMTP server configuration, and panel language.

> [!NOTE]
> Secrets saved in Cockpit (the SMTP password, Resend API key, and GIPHY API key) are encrypted with the instance's data-protection keys, take precedence over environment variables, and are never returned to the browser.

## Development

Cockpit is an npm workspace of the repository root, which shares one `package-lock.json` across `web/`, `cockpit/`, and `packages/stellarr-ui`:

```bash
# from the repository root
npm install
npm run dev -w stellarr-cockpit
```

The dev server listens on `http://localhost:3001` and proxies `/api` and `/health` to `STELLARR_API_ORIGIN` (`http://127.0.0.1:5000` by default).

In the production container image, Nginx serves the static build under `/cockpit/` on the same origin as the web client (`/ops/` redirects with `308`). All `/api/cockpit/*` endpoints require an authenticated session with the instance owner role.

## Localization

Cockpit supports English (`en`, default) and Polish (`pl`). The active locale is resolved in the browser on startup in this order:

1. `stellarr_locale` cookie (also used by the main web client).
2. First matching language (`pl` or `en`) in `navigator.languages`.
3. `en`.

Catalogs live in `src/i18n/en.ts` and `src/i18n/pl.ts` and define identical key sets. Components format messages via `t("some.key", { name: value })`.

## Verification

```bash
# from the repository root
npm run typecheck:cockpit
npm run lint:cockpit
npm run test:cockpit
npm run build:cockpit
```

The build runs TypeScript validation and outputs the static bundle to `cockpit/dist/`. `npm run preview -w stellarr-cockpit` serves the production build locally on port `4174`.
