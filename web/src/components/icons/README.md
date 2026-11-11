# Stellarr icons

The app uses one local SVG family, drawn for Stellarr with the soft geometry
and segmented contours of Iconsax Linear / Broken as its visual reference.
`paths.ts` is the single source, including formatting and noise-suppression
icons. `Icon` renders it everywhere in the web and desktop clients.

- Use a 24 × 24 canvas, a 1.5 px stroke, round caps and round joins.
- Keep optical padding around the silhouette; verify at 16, 20 and 24 px.
- Use `currentColor` so controls own colour, hover and disabled states.
- Reuse contours for related states and make each state's meaning distinct.
- Prefer a few soft contours and deliberate gaps over tiny internal details.
- Add missing shapes to this family instead of PNG masks or Unicode glyphs.
- Keep the accessible label on the control; `Icon` itself is decorative.

Brand marks, avatars, emoji content and waveform data are separate assets.

Standalone SVG exports live in [`branding/icons/`](../../../../branding/icons/).
Regenerate them with `npm run icons:export` from `web/`, or verify them with
`npm run icons:export -- --check`.
