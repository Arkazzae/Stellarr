# Stellarr Cockpit

Stellarr Cockpit is the instance operator panel (`cockpit/`), built as a standalone React + Vite single-page application. It provides:

- **Overview**: 30-day message/join activity and service status.
- **Users**: account management, active sessions, and built-in roles.
- **Servers**: list of servers on the instance with ownership transfer and deletion.
- **Runtime**: 1-hour process telemetry (memory, GC heap, CPU, threads, SignalR connections, and HTTP response rates).
- **Logs**: paged, searchable, and filterable 10,000-line in-memory log stream with TSV export.
- **Backups**: online SQLite snapshots and retention cleanup.
- **Settings**: instance name, time zone, retention policies, and Resend email configuration.

## Development

```bash
npm install
npm run dev
```

The dev server listens on `http://localhost:3001` and proxies `/api` and `/health` to `STELLARR_API_ORIGIN` (`http://127.0.0.1:5000` by default).

In the production container image, Nginx serves the static build under `/cockpit/` on the same origin as the web client (`/ops/` redirects with `308`). All `/api/cockpit/*` endpoints require an authenticated session with the instance owner role.

## Localization

Cockpit supports English (`en`, default) and Polish (`pl`). The active locale is resolved in the browser on startup in this order:

1. `stellarr_locale` cookie (set by the main web client).
2. First matching language (`pl` or `en`) in `navigator.languages`.
3. `en`.

Catalogs live in `src/i18n/en.ts` and `src/i18n/pl.ts` and must define identical keys. Components format messages via `t("some.key", { name: value })`.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run build` runs TypeScript validation and outputs the static bundle to `dist/`. `npm run preview` serves the production build locally on port `4174`.
