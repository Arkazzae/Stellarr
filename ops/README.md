# Stellarr OPs

A separate front end for the instance owner's panel: an overview, users with their
sessions and roles, metrics of the running process, logs and audit, backups, app
releases and instance settings.

## Running it

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3001`. In development, requests to `/api` and
`/health` are forwarded to `STELLARR_API_ORIGIN` (by default
`http://127.0.0.1:5000`; see `.env.example`).

In the production image the static build is served under `/ops/` on the same origin
as the main client. The `/api/ops/*` endpoints require a login with an account that
holds the built-in owner role. The panel relies on the persistent session and audit
registry, metrics of the running process, the log buffer and SQLite backups taken
online.

## Language

The panel is in English by default, with Polish as a translation. The language is
chosen in the browser each time the panel loads, never at build time, in this order:

1. the `stellarr_locale` cookie, which the main client writes (`pl` or `en`) when you
   change its language setting;
2. the first of the browser's preferred languages that is Polish or English;
3. English.

The `lang` attribute of the page follows the chosen language, and so do dates and
numbers. There is no language switcher here: change the language in the main client.

The panel's text lives in `src/i18n/en.ts` and `src/i18n/pl.ts`, which must have the
same keys. Components read it with `t("some.key", { name: value })`,
where `{name}` marks a placeholder in the message.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run build` checks the types and writes the build to `dist/`; `npm run preview`
serves it locally on port 4174.
