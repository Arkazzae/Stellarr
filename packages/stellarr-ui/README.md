# @stellarr/ui

Components and helpers shared by the web client (`web/`) and Cockpit (`cockpit/`). The package is private and holds:

- `@stellarr/ui`: the `cx` class-name helper.
- `@stellarr/ui/icons`: Stellarr's icon set, `Icon` and `ICON_PATHS`, the one registry both apps and [`branding/icons/`](../../branding/icons/) use. How to draw a glyph: [`src/icons/README.md`](src/icons/README.md).

It is consumed as TypeScript source: `exports` points at `src/index.ts` and there is no build step. Next.js compiles it through `transpilePackages`, and Vite and Vitest compile it as part of the importing app.

Inside the package, import with relative paths. The `@/` aliases belong to the apps and do not resolve here.

## Checks

Run these from the repository root, after `npm ci`:

```bash
npm run typecheck:ui
npm run test:ui
npm run icons:export -w @stellarr/ui -- --check
```
