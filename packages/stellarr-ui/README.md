# @stellarr/ui

Components and helpers shared by the web client (`web/`) and Cockpit (`cockpit/`). The package is private and for now holds only the `cx` class-name helper.

It is consumed as TypeScript source: `exports` points at `src/index.ts` and there is no build step. Next.js compiles it through `transpilePackages`, and Vite and Vitest compile it as part of the importing app.

Inside the package, import with relative paths. The `@/` aliases belong to the apps and do not resolve here.

## Checks

Run these from the repository root, after `npm ci`:

```bash
npm run typecheck:ui
```
