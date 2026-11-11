# Stellarr UI icons

Each icon is available as a separate SVG, matching the application's local
Iconsax-inspired Linear / Broken family. The files use a 24 × 24 viewBox,
a 1.5 px stroke, round caps and round joins. They scale without losing detail
and inherit their color through `currentColor`.

File names match the app's icon names converted to kebab case:
`micSlash` → [`mic-slash.svg`](mic-slash.svg),
`noiseGtcrn` → [`noise-gtcrn.svg`](noise-gtcrn.svg).

The source is [`web/src/components/icons/paths.ts`](../../web/src/components/icons/paths.ts).
Edit the source and regenerate these assets from `web/`:

```sh
npm run icons:export
```

Verify that all exported SVGs match the app:

```sh
npm run icons:export -- --check
```

Use an accessible label on the containing control and hide decorative inline
icons from assistive technology. Brand marks and mascots remain in their own
folders.
