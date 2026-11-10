# Stellarr localization

## Two independent settings

Stellarr keeps the interface language separate from message translation:

- `locale` selects the application text and the format of dates and times;
- chat translation is optional, has its own target language, and never changes
  the original message.

The supported languages are `pl` and `en`. English is the default. The
operator can change the instance default to Polish with `STELLARR_LANGUAGE=pl`;
the web server reads it on every request, so one image serves every instance.
The language of a request is resolved in this order: the `stellarr_locale`
cookie, `STELLARR_LANGUAGE`, English. The operator panel has its own catalogs
in `ops/src/i18n/` and follows the same cookie (see [`ops/README.md`](../ops/README.md)).

## The interface catalog

The source of the types is [web/src/i18n/messages/pl.ts](../web/src/i18n/messages/pl.ts).
The English catalog uses `satisfies Record<keyof typeof pl, string>`, so a
missing or extra key stops the typecheck. Text is accessed through the typed
`Translator` (`t(key, values)`). `{name}` values are interpolated without
interpreting HTML, and a placeholder with no value stays visible as written.
A test keeps Polish letters out of the source outside the catalogs, so every
sentence a person reads exists once per language.

`LanguageProvider` stores:

- `stellarr_locale` in a cookie, only so that SSR and hydration have the same
  `<html lang>` from the start;
- `stellarr_language_settings` in `localStorage`: the language, enabling
  translation, auto-translate and the target language. The language is stored
  only when the person chose one, so a later change of the instance default
  still reaches everyone who never picked a language.

User content and channel names remain data. They must not be put into the
catalog or translated without an explicit user action.

## How the translator loads

1. Enabling translation checks the three files of the language pair in the
   local `web/public/bergamot-models/registry.json`.
2. A missing model is streamed through the same origin: the client tries
   `/bergamot-models/` first and then `/bergamot-models-gcs/`. Only the registry
   file lives under the first path, so the models come through the second, which
   is a rewrite in `web/next.config.ts` during development and an Nginx proxy
   (`infra/nginx.conf`) in production, in both cases to the official Bergamot
   model store.
3. Progress is visible in the settings. Each complete file goes into the
   IndexedDB database `bergamot-models`, store `files`; an incomplete file is
   not saved.
4. A worker loads the copied WASM runtime (`web/public/codecs/bergamot/`) and
   the model without blocking the main thread.
5. CLD3 detects the language of the message. A message already written in the
   target language does not go through the model.
6. The result goes into a bounded memory cache (1,000 entries) and into the
   `stellarr-chat-translations` database (5,000 entries, oldest trimmed
   first). Identical parallel requests share one job, and messages the reader
   is looking at take priority in the queue.

The interface offers Polish and English as target languages, which are the
`plen` and `enpl` pairs in the registry. A language name in a list without a
model behind it is not language support.

## Adding another interface language

1. Add the code to `SUPPORTED_LOCALES` in `web/src/i18n/index.ts` and a separate,
   complete catalog in `web/src/i18n/messages/`, registered in `catalogs` in the
   same file. Every catalog needs a `language.name.<code>` key.
2. Add the native name to `NATIVE_NAMES` in
   `web/src/components/account/panes/LanguagePane.tsx`. Storage validation and
   the choice list already follow `SUPPORTED_LOCALES`.
3. Add the `Intl` tag to `LOCALE_TAG` in `web/src/lib/format.ts` and a test of
   dates and plural forms. `pluralForm` returns `one`, `few` or `many`, so
   check the counted messages against the plural rules of the new language.
4. Move new texts into the catalog; do not import state into presentational
   components, pass them `t` or a ready view model.
5. The choice list of the translation target uses the same locales.
   `TranslationTargetLanguage` in `web/src/i18n/index.ts` and `primaryPair` in
   `web/src/lib/chatTranslation/modelStatus.ts` name only `pl` and `en`, and
   `primaryPair` maps every target other than `en` to the `enpl` model. Extend both
   together with the registry entries and a runtime test of the new pair.

## Verification

```bash
cd web
npm test
npm run typecheck
npm run lint
npm run test:translation-runtime
```

The last command runs the system Chromium and a real worker and WASM, translates
a Polish sentence into English, and then runs the test again on the same
profile. The test fails if the second start downloads the model instead of
reading it from IndexedDB. It downloads the models, so it needs network access
to the model store, and it is not part of CI. The Chromium path defaults to
`/usr/bin/chromium` and can be changed with `STELLARR_CHROMIUM`.
