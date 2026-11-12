# Stellarr Cockpit

Stellarr Cockpit is the instance operator panel (`cockpit/`), built as a standalone React + Vite single-page application. It provides:

- **Overview**: headline counts, 30-day activity in six series, and the last hour of the API's and the database's availability. It refreshes itself every 30 s.
- **Users**: account management, active sessions, and built-in roles.
- **Servers**: list of servers on the instance with ownership transfer and deletion.
- **Runtime**: the last hour of the process (requests, errors, CPU, memory, connections, database latency) and of every service's availability, a bar per minute.
- **Logs**: paged, searchable, and filterable 10,000-line in-memory log stream with TSV export.
- **Backups**: database snapshots, or full archives with the stored files, the keys and the instance files, made in the background; verification and retention.
- **Integrations**: Resend for mail, and GIPHY for the web client's GIF search, with their keys.
- **Settings**: instance name, time zone, retention, the SMTP server and its password, and the panel's language.

Secrets set in Cockpit (the SMTP password, the Resend and GIPHY keys) are stored encrypted and never shown again. The panel opens in English; its language is chosen in **Settings** and kept in the browser. On a desktop it keeps the same proportions at any zoom-out level.

## Development

Cockpit is an npm workspace of the repository root, which holds the one `package-lock.json` and installs web, Cockpit and the shared `packages/stellarr-ui`:

```bash
# from the repository root
npm install
npm run dev -w stellarr-cockpit
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
# from the repository root
npm run typecheck:cockpit
npm run lint:cockpit
npm run test:cockpit
npm run build:cockpit
```

The build runs TypeScript validation and outputs the static bundle to `cockpit/dist/`. `npm run preview -w stellarr-cockpit` serves the production build locally on port `4174`.
