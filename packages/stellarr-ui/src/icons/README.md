# Stellarr icons

One local SVG family in two variants drawn from the same geometry:

- **broken**, the default: every main contour opened by one gap;
- **linear**: the same contours, closed and continuous.

The family follows the soft geometry of Iconsax Linear / Broken as a style
reference. Every glyph is drawn here from Stellarr's own geometry; nothing is
traced from or imported out of another icon set.

`Icon` renders it everywhere in the web and desktop clients and in Cockpit;
import it from `@stellarr/ui/icons`. A `variant` prop picks the variant for one
icon and `IconVariantProvider` for everything inside it.

## Files

- [`source/glyphs.ts`](source/glyphs.ts) draws every glyph. A plain path string
  is the same in both variants; `brk(d, [x, y])` opens the contour at that
  point in the broken variant.
- [`source/geometry.ts`](source/geometry.ts) holds the shapes (`rect`,
  `circle`, `arc`, `poly`), the transforms and the gaps, so corners, circles
  and gaps keep one measure across the family.
- [`paths.ts`](paths.ts) is generated: the static table the apps import. Do not
  edit it by hand.

After changing the source, build the table and the SVGs in
[`branding/icons/`](../../../../branding/icons/) from the repository root:

```sh
npm run icons:build -w @stellarr/ui              # write
npm run icons:build -w @stellarr/ui -- --check   # verify, as CI does
npm run icons:build -w @stellarr/ui -- --audit   # also list strokes that crowd each other
```

## Drawing rules

- A 24 × 24 canvas, a 1.5 stroke, round caps and round joins, `currentColor`.
- The live area is 2–22. Containers sit on 2.5–21.5 with soft corners (reach 6
  at full size, less on smaller shapes); a full ring reaches 2–22, because a
  circle looks smaller than a square of the same width.
- Separate strokes either join or keep 2.5 between centre lines, about 1 px of
  air at 24 px. `--audit` checks it.
- Broken: one gap of `GAP` (3.1) per main contour, on its longest straight run,
  upper right where the shape allows. Dots, short lines and small rings stay
  whole, so glyphs made only of lines look the same in both variants.
- A slash knocks out every part of the contour within 2.5 of it, in both
  variants (`knockLine`, `knockNear`).
- Reuse contours for related states and give each state a distinct meaning.
- Add missing shapes to this family instead of PNG masks or Unicode glyphs.
- Keep the accessible label on the control; `Icon` itself is decorative.

Brand marks, avatars, emoji content and waveform data are separate assets.
