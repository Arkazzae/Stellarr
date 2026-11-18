# Stellarr website

The project site: one page in three sections, with a WebGL scene of the Stellarr mark behind it. Scrolling, the arrow keys and the rail on the right move one camera along a single path through the sections. It is plain JavaScript on [Vite](https://vite.dev) and [three.js](https://threejs.org), with no framework, and it is its own npm project: it is not part of the root workspaces and is not built into the container image.

## Run it

```bash
cd website
npm ci
npm run dev       # a dev server with reload
npm run build     # the site in dist/
npm run preview   # serves dist/
```

The scene needs WebGL 2. Without it the page shows a notice and the sections still scroll.

## Where to change things

| To change | Edit |
| --- | --- |
| Page text, links, the install commands | `index.html` |
| The sections, their length and the camera path | `src/config.js` |
| Colors, type and layout | `src/styles.css` |
| The scene: mark, sand, lighting, camera | `src/gl/` |
| Scrolling, the rail, text reveals, the wordmark | `src/ui/` |

`src/main.js` wires them together. A section is a `<section class="page">` in `index.html` and one entry in `SECTIONS`; `CAMERA` holds the camera poses, keyed by scroll position.

## Branding

The logo, the astronaut, the icons and the fonts are read from [`branding/`](../branding), not copied. The 3D mark is built from `branding/logo/mark.svg`, the fonts are loaded from `branding/guidelines/fonts/`, and the header logo, the astronaut and the icons in `index.html` are inlined from `branding/logo/small.svg`, `branding/mascot/expressions/happy.svg` and `branding/icons/linear/`. Redrawing the logo reaches the scene on the next build; the inlined SVGs in `index.html` have to be updated by hand to match.

## Deploy

The site is a Cloudflare Pages project named `stellarr`, with `main` as its production branch. Pages builds nothing itself; the site is built from a checkout of the repository and uploaded. CI does this on every push to `main` that changes the site (the `website-deploy` job in `.github/workflows/ci.yml`). For a one-off deploy from a checkout:

```bash
cd website
npm ci
npm run build
npx wrangler pages deploy dist --project-name stellarr --branch main
```

The build reads the logo, astronaut, icons and fonts from `branding/`, so it needs the whole repository checked out, not only `website/`. A `--branch` other than `main` gives a preview address instead of production. Wrangler is not a dependency of the project; `npx` fetches it when the command runs.

`public/_headers` lets browsers keep the hashed files in `dist/assets/` for a year. Every other file, `index.html` included, is revalidated on each visit, so a new build shows up at once.
