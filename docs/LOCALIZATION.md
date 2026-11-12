# Localization

Stellarr supports English (`en`, default) and Polish (`pl`) across the web client, the Cockpit operator panel, and the ASP.NET Core API, plus optional client-side message translation powered by Bergamot WASM.

## Locale resolution and `STELLARR_LANGUAGE`

Interface language and chat message translation are independent settings:

- **Interface language (`locale`)**: Controls UI copy and `Intl` date/time/number formatting.
- **Chat translation**: Optional client-side translation of chat messages into a chosen target language (`pl` or `en`); never alters stored message content.

Setting `STELLARR_LANGUAGE=pl` (or `en`) configures the instance default:

1. **Web client (`web/`)**: Resolves the request locale in order:
   1. `stellarr_locale` cookie (written only when a user explicitly selects a language in Settings).
   2. `STELLARR_LANGUAGE` environment variable (read dynamically per request).
   3. `en`.
2. **Cockpit (`cockpit/`)**: Resolves the locale in the browser on load (see [`cockpit/README.md`](../cockpit/README.md)):
   1. `stellarr_locale` cookie.
   2. First match in `navigator.languages` (`pl` or `en`).
   3. `en`.
3. **API (`server/Stellarr.Api/`)**: Reads `Stellarr:Language` (`STELLARR_LANGUAGE`) at startup (`LanguageOptions`). Used for API problem details, validation errors, system join notices, initial role/channel names on new servers, audit log entries, and password-reset/test emails. Records already persisted in SQLite keep the language in which they were written.

## Message catalogs

### Web client (`web/src/i18n/`)

- [web/src/i18n/messages/pl.ts](../web/src/i18n/messages/pl.ts) defines the canonical `MessageKey` union.
- [web/src/i18n/messages/en.ts](../web/src/i18n/messages/en.ts) is typed with `satisfies Record<keyof typeof pl, string>`, ensuring missing or extra keys fail `npm run typecheck`.
- Components format strings via `t(key, values)`. `{name}` placeholders are interpolated as plain text without HTML parsing; unprovided placeholders remain literal (`{name}`).
- `LanguageProvider` persists:
  - `stellarr_locale` cookie so SSR and client hydration render the same `<html lang>`.
  - `stellarr_language_settings` in `localStorage` (`locale`, `chatTranslationEnabled`, `chatAutoTranslateEnabled`, `chatTranslationTargetLanguage`).

### Cockpit (`cockpit/src/i18n/`)

- Catalogs live in `cockpit/src/i18n/en.ts` and `cockpit/src/i18n/pl.ts` with identical key sets and `{name}` placeholder interpolation via `t(key, values)`.

### Backend API (`server/Stellarr.Api/Localization/`)

- `MessageKey.cs` enumerates all server-facing text keys.
- `Messages.en.cs` and `Messages.pl.cs` implement exhaustive switch expressions over `MessageKey`, and `Messages.Get(key, ...)` interpolates `{name}` placeholders.

## Client-side chat translation

1. Enabling chat translation checks the three model files (`model`, `lex`, `vocab`) for the language pair (`plen` or `enpl`) listed in `web/public/bergamot-models/registry.json`.
2. Missing model files are fetched from `/bergamot-models/` first and then `/bergamot-models-gcs/`, which rewrites to the Bergamot GCS bucket in `web/next.config.ts` (development) and `infra/nginx.conf` (production).
3. Downloaded files are stored in IndexedDB (`bergamot-models`, store `files`) only after full completion.
4. A Web Worker loads the local Bergamot WASM runtime (`web/public/codecs/bergamot/`) and model off the main thread.
5. CLD3 detects the source message language; messages already in the target language bypass translation.
6. Translations are cached in memory (up to 1,000 entries) and in IndexedDB (`stellarr-chat-translations`, up to 5,000 entries, LRU-trimmed). Concurrent requests for the same text are deduplicated, and visible viewport messages are prioritized.

## Adding a new language

1. **Web client**:
   - Add the locale code to `SUPPORTED_LOCALES` in `web/src/i18n/index.ts`, create `web/src/i18n/messages/<code>.ts`, register it in `catalogs`, and add `language.name.<code>` to all catalogs.
   - Add the native language label to `NATIVE_NAMES` in `web/src/components/account/panes/LanguagePane.tsx`.
   - Add the `Intl` BCP 47 tag to `LOCALE_TAG` in `web/src/lib/format.ts` and verify plural rules (`pluralForm`).
   - If supporting local chat translation for the new language, update `TranslationTargetLanguage` in `web/src/i18n/index.ts`, `primaryPair` in `web/src/lib/chatTranslation/modelStatus.ts`, and `web/public/bergamot-models/registry.json`.
2. **Cockpit**:
   - Add `cockpit/src/i18n/<code>.ts` and register the locale in `cockpit/src/i18n/index.ts`.
3. **Backend API**:
   - Add the code to `LanguageOptions.cs`, add `Messages.<code>.cs`, and wire it into `Messages.cs`.

## Verification

Install the dependencies once from the repository root with `npm ci`; `web/` and `cockpit/` are workspaces that share its lockfile.

```bash
# Web client
cd web
npm test
npm run typecheck
npm run lint
npm run test:translation-runtime

# Cockpit
cd ../cockpit
npm test
npm run typecheck

# Server localization tests
cd ..
dotnet test server/Stellarr.Api.Tests --filter LocalizationTests
```

`npm run test:translation-runtime` runs headless Chromium (`/usr/bin/chromium` or `STELLARR_CHROMIUM`) against the real Bergamot worker and WASM runtime, translates a sample message, and verifies that a second run loads the model from IndexedDB without re-downloading.
