# Stellarr UI icons

Every icon of the app is available as a separate SVG in two variants of the
same geometry:

- [`broken/`](broken/), the app's default: each main contour opened by one gap;
- [`linear/`](linear/): the same contours, closed and continuous.

The files use a 24 × 24 viewBox, a 1.5 px stroke, round caps and round joins.
They scale without losing detail and inherit their color through
`currentColor`.

File names match the app's icon names converted to kebab case:
`micSlash` → `mic-slash.svg`, `noiseGtcrn` → `noise-gtcrn.svg`.

The files are built from
[`packages/stellarr-ui/src/icons/source/glyphs.ts`](../../packages/stellarr-ui/src/icons/source/glyphs.ts),
which also builds the table the web client and Cockpit render. Edit the source
and rebuild from the repository root:

```sh
npm run icons:build -w @stellarr/ui
```

Verify that the SVGs match the app:

```sh
npm run icons:build -w @stellarr/ui -- --check
```

Use an accessible label on the containing control and hide decorative inline
icons from assistive technology. Brand marks and mascots remain in their own
folders.
