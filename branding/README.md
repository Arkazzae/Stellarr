# Stellarr branding

The logo, the mascot and the brand guidelines. These are the final drawings:
use the files as they are and do not redraw or recolour them.

## Files

| Path | What it is |
| --- | --- |
| `logo/mark.svg` | The logo: a solid speech bubble holding the three-bar meter that shows who is speaking. Light bubble, accent bars, for dark backgrounds. |
| `logo/small.svg` | The same mark redrawn for small sizes, with wider bars and a fuller body. |
| `logo/mono.svg` | One colour. It fills with `currentColor` and the three bars are cut out of the bubble. |
| `logo/tile.svg` | The app icon: the mark on a rounded 512 px tile in Darkest (`#09090b`). |
| `mascot/` | The astronaut, in the same four variants as the logo: `mark.svg`, `small.svg`, `mono.svg`, `tile.svg`. |
| `mascot/expressions/` | Eight faces of the astronaut, one per state: `speaking`, `idle`, `listening`, `happy`, `muted`, `away`, `connecting`, `failed`. |
| `guidelines/stellarr-brand-guidelines.pdf` | The brand guidelines, version 1.0 (draft). |
| `guidelines/index.html` | The HTML source of the guidelines. Open it in a browser; it loads the fonts in `guidelines/fonts/` (Outfit and JetBrains Mono). |

## Choosing a logo variant

- Use `mark.svg` at 48 px and up. Use `small.svg` from 16 to 47 px. The mark is
  not used below 16 px on screen.
- Keep clear space of x on every side, where x is the height of the shortest
  bar.
- On a light background the guidelines draw the bubble in `#09090b`; on an
  accent fill they draw it white. Use `mono.svg` when only one colour is
  available.
- Do not recolour the bars in a status colour, and do not add gradients, a
  glow, extra bars, stretching or rotation.
- The wordmark next to the mark is set in Outfit SemiBold, with a gap of x
  between the two. The tagline is "Talk on your own server."

## The mascot

The helmet is the same speech bubble as the logo. The astronaut appears in empty
states, onboarding and first-run screens, error screens next to a clear next
step, and in stickers and community posts. Each face stands for a state of the
app and always appears with its word:

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

The mascot never replaces the logo or the app icon, does not go inside buttons
or navigation, is never the only sign of a state, and does not appear in a
confirmation that deletes something.

## Colour

The accent is indigo `#6f65d1` (OKLCH 0.570 0.161 284). White text on it has a
contrast of 4.71:1. The accent marks actions and live state, on at most three
elements at once: the primary action, an open connection and the person
speaking. It is not used for channel selection, headings or decoration, and
destructive controls use the danger colour.

The core palette is the one of Midnight, the default theme:

| Role | Values |
| --- | --- |
| Surfaces | Darkest `#09090b`, Floating `#101113`, Dark `#18181b`, Tertiary `#1e1f23`, Primary `#222327`, Hover `#27272a`, Active `#33343a` |
| Text | Normal `#f3f4f6`, Muted `#b9bec9`, Faint for small text `#9aa0ad`, Faint for decoration `#747b89` |
| Lines | Default `#292e39`, Subtle white at 6%, Strong white at 20% |
| Status | Success `#3dd68c`, Warning `#f0b232`, Danger `#f2555a`, Info `#6ea8fe` |

There are six themes: Midnight, Slate, Evergreen, Harbor, Amethyst and Ink. A
theme is named for how it looks, in one plain English word, and never after a
company or a product. The full definitions are in `web/src/design/themes.ts`.

## Typeface

Outfit is the typeface of the interface and the wordmark. Code is set in
JetBrains Mono.

## Wording

English is the base language and Polish is a full translation written to read
naturally. Text is in sentence case, without exclamation marks or emoji.
Stellarr is one word with a capital S. The verbs for accounts are log in and
log out. A problem message says what happened and then what to do.

## Name and logo

The Stellarr name, the logo and the mascot are not covered by the MIT licence of
the code (see [`LICENSE`](../LICENSE)). They may be used to refer to the project.
They may not be used to brand other products or modified builds.

According to the guidelines, you can run Stellarr, changed or unchanged, for
your own group, use the name and the mark when writing about the project, and
say that your work is based on Stellarr. Ask first before using the mark on a
hosted service you charge for or on merchandise; to ask, open an issue in the
repository. Do not publish a fork under the Stellarr name or mark, suggest that
the project endorses your product, or alter the mark and present it as official.
This section of the guidelines is marked as a draft without legal review.
