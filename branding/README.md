# Stellarr branding

Logo, mascot, UI icons, color palette, typography, and usage rules for Stellarr. Use the logo and mascot SVG assets as provided without redrawing or recoloring them; UI icons inherit the interface color.

## Assets

| Path | Description |
| --- | --- |
| `logo/mark.svg` | Primary mark (48 px and above): light speech bubble with three indigo voice-meter bars, for dark backgrounds |
| `logo/small.svg` | Small-size mark (16–47 px): wider bars and fuller silhouette |
| `logo/mono.svg` | Monochrome mark (`currentColor` fill with cut-out bars) |
| `logo/tile.svg` | Application icon: primary mark centered on a rounded 512 px `#09090b` tile |
| `mascot/` | Astronaut mascot in `mark.svg`, `small.svg`, `mono.svg`, and `tile.svg` variants |
| `mascot/expressions/` | Eight state expressions: `speaking`, `idle`, `listening`, `happy`, `muted`, `away`, `connecting`, `failed` |
| [`icons/`](icons/) | 92 standalone UI icons, including formatting and noise-suppression modes; 24 × 24 SVGs with a 1.5 px `currentColor` stroke |
| `guidelines/stellarr-brand-guidelines.pdf` | Brand guidelines PDF (v1.0 draft) |
| `guidelines/index.html` | HTML source of the brand guidelines (uses `guidelines/fonts/` for Outfit and JetBrains Mono) |

## Logo usage

- Use `mark.svg` at `48 px` and above, and `small.svg` at `16–47 px`. Do not render the mark below `16 px`.
- Maintain clear space of `x` on all sides, where `x` is the height of the shortest meter bar.
- On light backgrounds, the bubble uses `#09090b`; on accent fills, it uses white; in single-color contexts, use `mono.svg`.
- Do not recolor the meter bars to status colors, apply gradients or glow effects, alter proportions, or rotate the mark.
- Set the wordmark in **Outfit SemiBold** spaced `x` from the mark. Tagline: *"Talk on your own server."*

## Mascot usage

The astronaut mascot is used in empty states, onboarding screens, recoverable error views, and stickers. Every expression must be accompanied by a text label:

| File | State |
| --- | --- |
| `speaking.svg` | Speaking |
| `idle.svg` | Idle |
| `listening.svg` | Listening |
| `happy.svg` | Happy |
| `muted.svg` | Microphone off |
| `away.svg` | Away |
| `connecting.svg` | Connecting |
| `failed.svg` | Connection failed |

Do not use the mascot in place of the application icon, inside buttons or navigation bars, as the sole indicator of state, or inside destructive confirmation dialogs.

## Color palette

Primary accent: **Indigo `#6f65d1`** (`oklch(0.570 0.161 284)`, 4.71:1 contrast with white text). Reserve the accent for primary actions, active connections, and speaking indicators. Destructive actions use the danger color.

Default **Midnight** theme palette (`web/src/design/themes.ts` defines all six themes: Midnight, Slate, Evergreen, Harbor, Amethyst, and Ink):

| Role | Tokens |
| --- | --- |
| Surfaces | Darkest `#09090b`, Floating `#101113`, Dark `#18181b`, Tertiary `#1e1f23`, Primary `#222327`, Hover `#27272a`, Active `#33343a` |
| Text | Normal `#f3f4f6`, Muted `#b9bec9`, Faint (small text) `#9aa0ad`, Faint (decorative) `#747b89` |
| Borders | Default `#292e39`, Subtle `rgba(255, 255, 255, 0.06)`, Strong `rgba(255, 255, 255, 0.20)` |
| Status | Success `#3dd68c`, Warning `#f0b232`, Danger `#f2555a`, Info `#6ea8fe` |

## Typography and UI copy

- **UI and wordmark**: Outfit
- **Monospace / code**: JetBrains Mono
- **Copy style**: Sentence case, no exclamation marks or emoji in UI chrome. Write *Stellarr* with an uppercase *S*. Use *log in* / *log out* for authentication actions. Error messages state what failed followed by how to resolve it.

## Name and logo policy

The Stellarr name, logo, and mascot are not covered by the MIT License of the source code (see [`LICENSE`](../LICENSE)):

- You may run modified or unmodified builds for your own group, use the name and mark to refer to Stellarr, and state that your project is based on Stellarr.
- Do not distribute modified forks under the Stellarr name or logo, imply official endorsement, or use the mark on commercial hosted services or merchandise without prior permission (open a GitHub issue to request permission).
