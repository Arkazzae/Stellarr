# Stellarr — Design

Design specification for the Stellarr web client. It describes the interface in
`web/`: layout, colour, type, space, components, motion and the accessibility
contract. The measures come from the style sheets in `web/src/styles/`. Brand
matters (the logo, the mascot, the colour story and the voice) are in
[`branding/`](branding/README.md) and are only linked from here. Web code cites
sections of this file as `DESIGN.md §3`, `§4` and `§10`, so the numbering does
not change.

---

## 1. The scene

Four or five people who already know each other, talking late in the evening from
ordinary rooms. Laptop screens dimmed. Someone is half-listening while doing something
else. Nobody is here to be impressed by the software.

The interface is a lit desk in a dark room: the conversation is the lit part, everything
else recedes until touched. Warmth appears only where something is *live* — a person
speaking, a connection open, a primary action offered. Nothing else lights up.

**Adjectives:** precise, quiet, dependable, warm at the edges.
**Not:** playful, gamified, corporate-dashboard, futuristic.

**Language.** The interface supports **English and Polish**. English is the default;
an operator can make Polish the default of the instance with `STELLARR_LANGUAGE=pl`.
The choice of a person is persisted per browser and mirrored to a small locale
cookie so the first server render uses the right language. Product copy belongs
in the typed catalogs under `web/src/i18n`; user-authored channel names,
messages, profiles and server descriptions are data and are never translated as
interface chrome. Optional message translation is a separate, explicit local
feature (see [`docs/LOCALIZATION.md`](docs/LOCALIZATION.md)). Code, comments and
this document are in English — they are for whoever maintains the app, not for
whoever uses it. Polish status words avoid gendered adjectives: "W sieci",
"Zaraz wracam", "Poza siecią", never "Dostępny". Names that are user data are
never declined into a Polish case.

## 2. What this is not

These are hard constraints, not preferences.

| Rejected | Why |
| --- | --- |
| A server column that is always open | A private instance has few servers, so the column is closed until it is asked for (§3) |
| Glassmorphism and translucent panels | Costs GPU on old laptops, reduces text contrast. The only blur is behind the scrim of a full-screen dialog |
| Gradient text and decorative gradients | Gaming spectacle; conflicts with "quiet and dependable". Gradients appear only as fades over text or media, as the highlight of the selected sound in the soundboard list, and as the placeholder of a profile banner in the person's own hue |
| Identical card grids, cards nested in cards | The transcript is a stream, not a collection |
| Rounded panels for the layout regions | Rail, room and roster are square-cornered regions separated by 1px lines; rounding belongs to controls, cards and dialogs |
| Eyebrow labels above headings, and "01 / 02 /" section numbering | Landing-page scaffolding. Uppercase is limited to small captions (group names, field labels, the unread marker); headings and message text are never uppercase |
| Page entrance choreography and parallax | Motion here means "state changed", nothing else. The one staggered reveal is the tile column of the server launcher |
| Emoji as UI iconography | Renders inconsistently per platform, ignores text weight |

## 3. Layout — "one rail, one room"

Two structural regions, the rail and the room. Two more are **on demand**: the
server column on the left, and the roster on the right, which never becomes a
permanent wall. The server column, the rail and the roster are grid tracks that animate
between 0 and their width, so the room reflows and nothing ends up underneath anything.

```
┌─────────┬──────────────┬─────────────────────────────────────┬──────────────┐
│ SERVERS │  RAIL 248px  │ ROOM                                │ ROSTER 264px │
│  68px   │              │  header 52px                        │              │
│ (on     │  Server name │  ───────────────────────────────    │  People      │
│ demand) │  Text        │   [AD]  Ada   19:04                 │  Online      │
│         │   # general  │         shall we start?             │   Ada        │
│         │  Voice       │         give me a minute            │   Ilya       │
│         │   ◉ Lounge   │                                     │  Offline     │
│         │     Maja     │   [NI]  Nils  19:06                 │   Nils       │
│         │     Ada      │         [image]                     │   Jo         │
│         │  ──────────  │  ───────────────────────────────    │              │
│         │  Connected   │  [ Message #general        ]  [→]   │              │
│         │  Lounge·00:42│                                     │              │
│         │  [mic][...]  │                                     │              │
│         │  [AD] Ada    │                                     │              │
└─────────┴──────────────┴─────────────────────────────────────┴──────────────┘
```

**How the shell is put together:**

1. **The server column** is 68px wide, or 0 until the switch button left of the
   server name opens it. It holds the servers and the entry for friends and direct
   messages. In the direct-message space the rail lists conversations and the roster
   track stays closed.
2. **Voice membership lives inside the voice channel**, indented under it in the
   rail — where you look to decide whether to join. Not duplicated in a separate column.
3. **The voice dock is part of the rail**, docked to its bottom edge above the account
   row, not a floating island.
4. **The roster is a toggle.** Below 1024px it opens from the people button in the room
   header; from 1024px it opens from the caret at the top of the avatar column, and the X
   in its header closes it. It is grouped by presence ("Online" / "Offline"), and what a
   person is doing in a call is shown by the speaking ring on the avatar.
5. **The transcript uses an avatar column**: a 40px avatar sits beside each author
   group, 12px from the text, with 20px of padding at the sides of the room.

### Regions

| Region | Element | Notes |
| --- | --- | --- |
| Servers | `<nav aria-label="Servers and direct messages">` | 68px when open, `inert` when closed. |
| Rail | `<nav aria-label="Server and channels">` | Fixed 248px. Own scroll. |
| Room | `<main>` | Header `<header>` of 52px, transcript `role="log"`, composer `<form>`. |
| Roster | `<aside aria-label="People">` | 264px open, 60px avatar column when closed (from 1024px), `inert` when it is off screen. |

The rail header (52px) holds the server name at 20px/600, the switch to the server
column, and the invite and settings actions. Under it the rail scrolls: sections,
text channels, voice channels with their occupants, and the threads of a channel.

### Responsive

| Width | Server column and rail | Roster | Channel panel |
| --- | --- | --- | --- |
| below 768 | One shared drawer from the left, raised by the burger in the room header | Drawer over 60% of the width (at least 232px) | Drawer |
| 768 | Rail persistent at 248px; the server column opens on demand | Drawer, 264px | Drawer |
| 1024 | As above | Avatar column of 60px; the caret at its top opens it to 264px | Drawer |
| 1280 | As above | Avatar column | Track of 320px beside the room |
| 1440 | As above | Open by default (264px) | Track of 320px |

Only one overlay drawer may be open at a time; opening one closes the other. While a
drawer is open a scrim covers the room, and `Esc` closes it. The page itself never
scrolls: the shell is as tall as the viewport and each region has its own scroll.

Message text is held to `--measure` (72ch); the transcript rows themselves run the
width of the room. A short conversation is anchored to the bottom of the transcript,
next to the composer, rather than stranded at the top.

No horizontal overflow at any width. Long unbroken strings (URLs, pasted tokens) wrap
with `overflow-wrap: anywhere`. Channel and member names truncate with an ellipsis.

## 4. Color

A preset is a complete palette, not a hue seed. The source of truth is
`web/src/design/themes.ts`; the pre-hydration script, settings previews, runtime and tests
all consume the same object. Each preset defines these roles:

| Group | Roles |
| --- | --- |
| Accent | accent |
| Backgrounds | darkest, dark, primary, secondary, tertiary, hover, active, floating |
| Text | normal, muted, faint |
| Borders | subtle, default, strong |
| Semantic | success, warning, danger, info |

`web/src/styles/themes/recipe.css` maps the public palette onto the semantic component vocabulary
(`--surface-*`, `--text-*`, `--line-*`, `--accent-*`). Components never name preset
colours directly. Structural regions use explicit `--surface-room` and
`--surface-sidebar` roles; a sidebar never relies on an elevation token by accident. The
light scheme derives a restrained neutral ramp, tuned per preset in
`web/src/styles/themes/palettes.css`, and uses the selected accent, darkened for pale surfaces;
every named preset has a usable light counterpart. A high-contrast setting moves only
text and lines.

The raw `faint` colour stays in the palette, but 11–13px interface copy uses a
contrast-safe companion value. Normal, muted and effective faint text must reach 4.5:1
(WCAG 2.2 AA) against every dark background role of every preset; `web/src/design/themes.test.ts` checks
it. Text placed on the accent uses whichever of black or white has the higher contrast.

### Accent

The preset supplies its recommended accent. A user may change that one colour without
turning the settings pane into a per-token paint editor. Selecting another preset restores
that preset's recommended accent. Hover, quiet, text and soft variants are derived from the
chosen colour, while the foreground on an accent fill is chosen by measured contrast.

**Accent budget: at most three accent-carrying elements visible at once.** In practice:
the send button, the primary action of a dialog, and one speaking ring. If a fourth wants
accent, something else is wrong. Accent marks actions and live state, not navigation:
the active channel is a neutral fill.

### Status

Success, warning, danger and info belong to every palette. The component tokens derive
legible text variants while keeping the supplied semantic colour for lines, glyphs and
fills. Destructive controls remain quiet: transparent fill, a danger label and a border
that adopts the danger colour on hover. Hanging up a call, in the call bar, is the one
control allowed to be loud.

### Status is never color alone

Every state carries **shape + text** in addition to hue. This is a correctness
requirement, not a nicety.

| State | Glyph | Text (visible or accessible name) |
| --- | --- | --- |
| Online | Full disc | "Online" |
| Idle | Disc with a bite out of its top right | "Idle" |
| Do not disturb | Disc with a bar cut across it | "Do not disturb" |
| Offline | Hollow ring | "Offline" |
| In voice, silent | Plain avatar | "Silent" |
| In voice, speaking | Accent ring of 2px around the avatar | "Speaking" |
| Mic muted | Crossed microphone in the danger colour | "Microphone" with `aria-pressed="true"` on the dock button |
| Voice connecting | Word in the dock | "Connecting" in a `role="status"` |
| Voice connected | Word in the live colour, with link quality and latency | "Connected" in a `role="status"` |
| Voice failed | Word in the dock | "No audio connection" in a `role="status"` |

Rendering the app in greyscale must lose zero information: the dot has four distinct
shapes, and the presence word and the speaking state are always in the accessible name
of the row or the avatar, visually hidden where the column has no room for words.

### Presets

Six presets are available: Midnight (default), Slate, Evergreen, Harbor, Amethyst and
Ink. Midnight and Slate share the Stellarr accent `#6f65d1`, which is also the accent of
a fresh install. Evergreen uses `#1db954` on neutral near-black surfaces, Harbor
`#1a9fff` on deep navy, Amethyst `#9146ff` on neutral black and Ink `#58a6ff` on graphite
navy. The settings pane exposes a compact, read-only inspector for every role, so a
preset can be audited without making every token editable. The names describe how a
preset looks; none is named after a company or a product.

## 5. Type

Outfit is the default. Every selectable face is self-hosted, so an instance never fetches
a font from a CDN in the browser.

```
--font-sans: "Outfit", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
             "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", Menlo,
             Consolas, monospace;
```

The named scale is `--text-10`, `-11`, `-12`, `-13`, `-14`, `-15`, `-16`, `-18`, `-20`,
`-24` and `-28`, in pixels (`web/src/styles/theme.css`). The sizes in use:

| Size / line-height | Weight | Use |
| --- | --- | --- |
| 11px | 600 | Group captions (uppercase, see below), the unread marker |
| 12px | 400 | Timestamps, captions, day separators |
| 13px | 400 | Rail items, buttons, the room topic |
| 14px | 500 | Roster names |
| 15px / 1.6 | 400 | **Message bodies and the composer** (`--msg-size`) |
| 16px / 1.4 | 550 | Channel title in the room header |
| 20px / 1.25 | 600 | Server name in the rail header |
| 28px / 1.2 | 600 | Heading of an account screen |

The dense chrome also uses half steps (10.5, 11.5, 12.5 and 13.5px). Message bodies
default to 15px, not 14px — this is a reading surface. Line height is 1.6 with a 72ch
measure.

Timestamps, counts and level readouts use `font-variant-numeric: tabular-nums` so
numbers do not jitter as they update. Letter-spacing is used on uppercase captions
(0.04em to 0.1em) and on the 28px account heading (−0.015em); body text and rail items have
none. Uppercase is applied only to small captions: the rail group names ("Text",
"Voice"), the field labels of settings and the unread marker.

### The font pack

Twenty-eight choices are available through `data-font` on `<html>`:

Outfit, Inter, Geist Sans, DM Sans, Plus Jakarta Sans, Manrope, Figtree, IBM Plex Sans,
Source Sans 3, Noto Sans, Open Sans, Lato, Poppins, Montserrat, Raleway, Nunito, Rubik,
Quicksand, Baloo 2, Varela Round, Comfortaa, Fira Code, JetBrains Mono, Source Code Pro,
IBM Plex Mono, Space Grotesk, Sora and Lexend.

`npm run fonts:sync` refreshes the Latin and Latin Extended WOFF2 assets and generates
`web/src/styles/themes/font-faces.css`. The committed assets make LAN-only and offline deployments work;
an unused `@font-face` declaration does not download its source, so the browser requests
only the chosen family and the subsets needed by the current text.

### Size and density

Two more axes, `data-size` and `data-density`, and they are separate questions — a
compact transcript at 16.5px is a legitimate answer to both.

| Axis | Values | What moves |
| --- | --- | --- |
| `data-size` | 13.5 / 15 / 16.5px → `--msg-size` | Message bodies and the composer, nothing else |
| `data-density` | cozy / compact → `--msg-pad-y` (9 / 4px), `--msg-leading` (1.6 / 1.45), `--msg-line-gap` (2 / 0px) | Air around and inside a message block |

Chrome — rail rows, headers, buttons — keeps the scale it was drawn at. Hit targets are a
contract, not a preference, and a settings pane that resized its own labels while you read
them would be a funhouse mirror.

## 6. Space, radius, elevation

**Spacing** is written in pixels directly in the style sheets; there is no spacing
token. The values used most are 8, 12, 10, 6, 4, 16, 2, 14 and 20px. The layout
constants are tokens:
`--rail-w` 248px, `--roster-w` 264px, `--roster-mini-w` 60px, `--servers-rail-w` 68px and
`--header-h` 52px.

**Radius:** `--radius-sm 6px` (buttons, inputs, rail rows) · `--radius-md 10px` (attachments,
cards, list rows) · `--radius-lg 14px` (menus, popovers, call tiles). Composer, call
controls and the largest dialogs use 16px to 20px, avatars and round buttons use 50%, and
a few pills (the jump-to-newest button, the watch button) use 999px. Avatars are **round**:
24, 32, 40 and 64px (`--av-xs`, `--av-sm`, `--av-md`, `--av-xl`), with the presence dot
scaled to the face.

**Elevation:**

- Flat regions (rail, roster, room header, composer area): a **1px line**, no shadow.
- Lifted things get a shadow, and the shadow grows with the distance from the page:
  `--elev-pop` (`0 4px 14px`, 45%) for popovers and menus, `--elev-drawer`
  (`0 8px 24px`, 50%) for drawers and the call-bar menus, `--elev-modal`
  (`0 34px 90px`, 62%) for dialogs. A dialog has both its 1px line and its shadow.

## 7. Components

### Rail

Server name at 20px/600 with a 1px bottom line. Group captions ("Text" and "Voice") in
`--text-faint`, 11px uppercase, and a collapsible section header above the channels it
holds.

Channel rows: 32px tall, `--radius-sm`, `#` or a speaker glyph at 16px, name at 13px.
Idle `--text-muted`; hover `--surface-overlay` + `--text`; **active** gets a neutral
`--surface-base` fill with `--text` text and glyphs, plus `aria-current="page"`. Accent
colour remains reserved for actions and live state rather than ordinary navigation
selection. An unread channel brightens its name and shows a count of up to 18px in the
accent; a muted one shows a muted mark; the settings cog replaces the count on hover.

Under a voice channel with occupants, an indented list of 30px rows: a 24px avatar, the
name, and a crossed microphone when the person is muted. The speaking ring is on the
avatar, and the row carries a visually hidden "Speaking" or "Silent". The people in a
call can be dragged to another voice channel by members who are allowed to move people.

### Voice dock

Appears in the rail only when a voice session exists, above the account row. Two rows:

1. The headline in a `role="status"`: "Connecting", "Connected", "Reconnecting",
   "Unstable connection" or "No audio connection" (plus "Waiting for microphone" and
   "Your screen"), with link quality and latency next to "Connected". Under it the channel
   name and the elapsed time. At the end of the row: the noise-reduction button and
   the **Disconnect** button (quiet: it takes the danger colour only on hover).
2. The toggles: microphone (`aria-pressed`, crossed glyph when muted), deafen, camera,
   screen share and the soundboard.

The noise-reduction button cycles off, RNNoise, GTCRN, Speex and the browser's own
suppression; its label always states the current and the next mode, and the live
microphone capture follows the persisted setting without leaving the call. The level of the
microphone is shown in the voice settings, not in the dock.

### Transcript

`role="log"`, `aria-live="polite"`, `aria-relevant="additions"`, `aria-label="Messages in
#general"`.

Messages are grouped: consecutive messages from one author within 5 minutes share a
header. The group header is `author name (15px/600, in the person's own colour) · time (12px,
--text-faint)`, and the 40px avatar sits in the column beside the group. The messages of the
group stack under the header in the same column. Message rows are not interactive, so they
are deliberately not tab stops — turning a hundred messages into a hundred tab stops would
be a worse defect than the one it fixes. The `<time>` element is in the DOM, so assistive
tech always reaches it. Hovering or focusing a message raises a toolbar for reactions and
actions, and a wash of `--surface-hover` marks the entry.

No bubbles, no per-message cards, no zebra striping. The vertical rhythm is the padding of
a group (`--msg-pad-y`, 9px in the cozy density) and `--msg-line-gap` between its messages.

Images: `--radius-md`, capped at 400×300 CSS px. Clicking opens the viewer with the
full picture and controls for the previous and the next attachment.

Prose that exceeds eight rendered lines remains ordinary message text and is clipped
behind a quiet **Show more** disclosure; expanding it happens inline. Code becomes
a 560px syntax window only when fenced or explicitly selected in the composer. The
window shrinks to the available width on narrow screens.

Day separators: a hairline with a centered date, 12px. The first unread message is
marked by a separator in the accent text colour.

### Pinned messages

A pin puts one message above the conversation for **everyone** who opens the channel.
That makes it moderation, not a bookmark: it takes `manageMessages`, the same permission
the bin takes, and the server enforces it again. A channel holds at most 50; the 51st is
refused with a sentence naming the rule and the way out, never "invalid input".

Three doors, one action, and the label is read off the message so they cannot disagree —
**Pin** on an unpinned one, **Unpin** on a pinned one:

- the hover toolbar, where it folds away first on a narrow screen,
- the right-click menu on the block,
- the pinned list itself, on hover over a row.

A pinned message says so above its text — a pin glyph and the word "Pinned", in
`--accent-text`. Never a tinted message: the pin is a note about where the message is
filed, not a change to what it says.

The list lives in the channel panel's **Pinned** tab, newest pin first, and is its own
read (`GET /api/channels/{id}/pins`) rather than a filter over the transcript — a pin is
normally far above the loaded window, and a list that filled in as you scrolled would not
be a list of the pinned messages. On wide screens the panel (320px) spans the room's full
height, so the room header ends at its left edge; on narrower screens it becomes a
full-height overlay drawer. Each row is the author, the time the message was *said*,
and two clamped lines of it; clicking scrolls the transcript there and flashes it, exactly
as the reply line does, and does nothing for a message older than the loaded window.

Search is the first tab of that same full-height channel panel, beside **Pinned**,
**Media** and **Links**. The topbar keeps one channel-panel toggle. Opening the
panel restores its last-used tab, and selecting **Search** focuses the channel-search
field. Search reads a durable SQLite FTS index of the whole channel, not the transcript
window. It indexes message text, author names, attachment names and content types, plus
link URLs, domains, titles and descriptions; Polish diacritics are folded for matching.
Results stay inside the panel and jump back to their message in the transcript, including
messages older than the currently loaded window.

**Media** and **Links** use the same complete server-side catalogue and page backwards
independently of transcript scrolling. The first page is newest first, and a quiet
**Show older results** action reaches the rest. A newly received item is merged into the
open list immediately, without waiting for a refetch.

### Threads

A thread opened from a message starts as a 480px panel spanning the room's full height,
including the header row. A text channel with threads gains one inline disclosure in the
left rail; expanding it shows the complete server-side thread catalogue, ordered by
latest reply, newest first, and independent of the loaded transcript window. Choosing a
thread there switches to its channel, reads the complete conversation and opens it across
the entire middle room column. Its header can restore the 480px panel without closing the conversation. On
narrower screens the panel overlays the room and the same modes use the room's full width.
A real composer stays fixed at the bottom of the thread and sends text, attachments, GIFs
and voice messages as replies to its root; the channel composer is not duplicated behind
it. A collapsed thread list adds no spacing between ordinary channel rows.

### The browser's own right-click menu

Suppressed by default, allowed where the browser knows something the app does not. The
default menu is about the *document* — "Back", "View page source" — which is never
about the thing under the pointer and is always in the way of a deliberate press.

It is kept on: fields (paste, undo, spell-check suggestions the app cannot even see),
links, images/video/audio, and a live text selection containing the pointer. `Shift` is the
escape hatch everywhere, matching what the app's own menus already honour.

The app menu on a chat message includes **Open thread** whenever the backend supports
threads, invoking the same action as the hover toolbar.

### Composer

Auto-growing `<textarea>`, 1 to 8 lines, at `--msg-size` and `--msg-leading`, in a box of
`--surface-field` with a 1px `--line-subtle` border (`--line` while focused), a 16px radius
and a minimum height of 54px. The placeholder names the channel ("Message #general") and the
field also carries it as its accessible name.

- `Enter` sends. `Shift+Enter` inserts a newline.
- A message with only whitespace and no attachments cannot be sent. The send button, a
  round 34px accent button, appears when there is something to send and stays out of the
  way until then.
- The server's limits are mirrored client-side so a rejection costs no round trip:
  20,000 characters per message and up to 10 attachments. The server accepts images
  (JPEG, PNG, GIF, WebP), audio, video, PDF, ZIP, JSON, plain text and Office documents,
  with a default size limit of 10 MB for an image, 25 MB for audio and for other files,
  and 100 MB for video. Exceeding a hard limit names the rule, not "invalid input".
- The plus button opens a file picker for all of these; paste and drag-drop also attach.
- Pending attachments show as chips above the box: 36px thumbnail, file name, a
  delete button (`aria-label="Delete <name>"`), an upload progress state, and a retry
  action for a failed upload.
- A failed send keeps the draft and shows an inline `role="alert"` sentence under the box
  ("The message could not be sent. Try again."). Text is never silently lost.

The microphone records a **standalone voice message** (no text or other attachments).
The composer box becomes the recorder; nothing is nested inside it, and the waveform
takes every pixel the fixed controls do not.

- While recording: `Cancel · red dot + "Recording" · live input level · elapsed · Stop`.
  The bars are the real microphone in `--accent`. They **start at nothing** and grow in
  from the right edge, one per 80ms sample, then scroll once the row is full — a flat
  line drawn before anything was heard is a measurement of silence that was never taken.
  Older samples fade out towards the left under a long mask, so the right edge is now.
  The red dot does not pulse: the waveform is already the moving thing, and two rhythms
  out of step read as decoration. The 10:00 ceiling is not shown until the last 30
  seconds, when the label becomes a countdown and the clock turns `--danger-text`.
  Stop is a neutral control: it produces the preview, so it is not destructive.
- After stopping: `Delete · Play · waveform of the finished file · position · Send`.
  The preview waveform is decoded from the recording with the same code the transcript
  uses, and fills in behind the playhead — so it is the message, not a picture of the
  last few seconds of it. If the browser cannot decode it, the frozen live tape stays.

**Bar density is a property of the row, not a constant.** The transcript measures a file
into 56 bars for a 420px attachment — a 3.5px bar every 5.5px. The composer's row is the
width of the room, and those same 56 stretched across it are 8px wide and 3px tall: a line
of squares. The recorder measures far more finely and caps how fat a bar may get, so quiet
passages read as a line of round dots at any window width.

The selected input device and voice-processing settings are shared with calls. A failed
send keeps the local preview and offers another attempt; cancelling, changing rooms or
unmounting always releases the microphone. Recorded audio is labelled "Voice message" in
the transcript instead of exposing its generated file name.

### Account screens

Login, registration, the recovery request and the new-password screen share one
centered column, 360px, on `--surface-canvas`. The column opens with the lockup —
the application mark beside the word Stellarr, at `--text-16` — then the heading naming the
task at `--text-28`, then one line of context at `--text-15` in `--text-muted`. Three text
blocks, and only one of them is large: a second heading-sized line competing with the first
is what turns this screen into noise. Below that come login-or-email and password fields,
then one primary button, then quiet text links to registration and password recovery. No
card with a shadow, no split hero, no illustration.

The mark is `web/src/components/auth/StellarrMark.tsx`: a speech bubble holding the three-bar level
meter, the shape the brand uses for text and voice in one. Its bubble takes `currentColor` and its
meter takes `--accent`, so the lockup follows both the palette and a personal accent without
naming a colour of its own. The brand drawings of the logo and the mascot, with the rules
for using them, are in [`branding/`](branding/README.md).

Vertical rhythm belongs to the column's `gap`, never to a margin on a child. Every account
screen puts the same three parts in the column — header, form, links — so the spacing holds
without a single per-screen exception.

Errors are one `role="alert"` above the button, in `--danger-text`, with a plain sentence.
Invalid fields get `aria-invalid` and a `--danger-line` border. The submit button shows a
busy state and stays disabled while the request is in flight.

Registration, the recovery request and the new-password screen use the same column and
control vocabulary. The recovery request always gives the same successful answer, whether
the address exists or not. A reset link is valid for 60 minutes and one use; success
sends the user back to login, while a missing, expired or reused token offers a new
recovery request.

### Controls — all four states, always

Every interactive element defines hover, focus-visible, active, and disabled. None may be
communicated by color alone.

| State | Treatment |
| --- | --- |
| Hover | Surface steps up one level (`--surface-overlay`), text to `--text` |
| Focus-visible | `2px solid --accent-quiet` outline, `2px` offset — never suppressed |
| Active | Surface steps back down, no transform on layout-affecting elements |
| Disabled | Dimmed, `disabled` or `aria-disabled`, and a `title` giving the reason where it is not obvious |

Minimum hit target 32×32 CSS px on pointer devices, 44×44 on coarse pointers
(`@media (pointer: coarse)`).

### Skeletons, empty, error

- **Skeleton** — bootstrap only (`web/src/app/AppSkeleton.tsx`). Neutral blocks matching final
  geometry, so nothing jumps when data lands. `aria-busy="true"` on the region, plus a
  visually hidden status.
- **Empty list** — one sentence naming the state ("Nobody is here."), plus what to do
  where there is something to do. No illustration.
- **Connection lost** — a notice beside the thing that failed, not a toast: a full outline,
  a labelled glyph, the cause and the next step, with the action as a button
  (`error-notice`). `role="status"` (polite) for reconnecting, `role="alert"` for failure.
- **Errors** name what failed and what to do next. Never "Something went wrong."

## 8. Motion

Motion communicates a state change. Nothing else moves.

```
--dur-fast: 90ms    state feedback (hover, press)
--dur-base: 140ms   toggles, dock and drawer transitions
--dur-slow: 200ms   overlay enter (the largest shared duration)
--ease-standard: cubic-bezier(0.2, 0, 0, 1)
```

Permitted: opacity and transform on overlays and on a view that takes the room;
colour and border transitions on controls; grid-track animation of the rail, the
roster and the panels; the speaking ring fading in and out.

Forbidden: page entrance choreography, parallax, looping ambient animation, anything that
moves without a user action or an incoming event. The setting for reduced motion, and the
`prefers-reduced-motion` media query, shorten animations and transitions to almost
nothing.

### Screen share

A share appears on the call stage, as a band above the participant tiles: a hairline
border, `--radius-md`, no card around it and none inside it. The picture is shown with
`object-fit: contain`, so the video letterboxes instead of being cropped. A share
does not start playing on its own: a viewer of someone else's share presses **Watch**,
and **Stop watching** ends it. Several people may share at once; a local focus switcher at
the top of the stage lets each member choose which surface has the stage, and the
participant tiles shrink to a row of 170px tiles below a focused share. Your own share is
stopped with the screen-share toggle in the dock or the call bar.

Shared audio plays through a single dedicated sink, so the video element on the
stage stays muted. Two sinks would play the same sound twice.

### Camera in a call

The camera is part of the participant's tile. When it is on, the picture replaces the
avatar, but the name, the mute state and the outline of the person speaking stay in
the same places. A speaking tile gets an accent border and a soft glow, in a fixed
violet that does not follow the personal accent, and its avatar pops once. The local
preview is always muted and is not mirrored by an extra element outside the stage.

The camera button works only during a call. While the permission is pending the button
is blocked and labelled "Turning camera on". A denied permission, a missing device and
an unplugged active camera are recoverable errors: the voice call continues and the message
says what the user should check. Turning the camera off and leaving the call release the
device immediately.

Capture is video only. The arrow beside the camera opens a local choice of quality:
480p24, 720p30 or 1080p30; the active profile is described in the header of the panel.
Changing the quality or the device in "Voice and video" replaces the track in the active
call without disconnecting and updates the sender's limit. The camera and a shared screen
can run at the same time; their streams have separate roles in the RTC contract and must
not be recognised from the order of events.

### Voice and video settings

The settings are the "Voice and video" pane of the user settings dialog, and the call bar
links to it from the arrows beside the microphone and the camera. The live level meter
stays active, so sensitivity can still be tuned while speaking; every change applies
immediately and persists without a separate Save step. Device choices remain local to the
browser, while the speech detection sensitivity follows the signed-in account between
devices. The dialog traps Tab, closes on Escape, locks background scrolling and returns
focus to the control that opened it.

### Mobile calls and the lock screen

The mobile web client publishes every active voice room through the Media
Session API. Supporting browsers may therefore show the room on the Android
lock screen and expose microphone mute and hang-up actions. This is progressive
enhancement: an unsupported system action is omitted and can never break the
WebRTC call underneath it.

An incoming direct call shows a banner in the app with a ringtone. While the page is open
but hidden, it also raises a system notification until the call is answered, declined
or ended. Delivery is limited to a live page: the web client does not claim to reach a
closed browser, a revoked site permission or a page that the OS has suspended.

Per-participant playback volume lives in the person's right-click menu: on their
voice-channel row, their in-call roster row and their stage tile. It appears only for a
remote participant in the current call, runs from 0 to 200 percent with 100 as the
default and stays open while adjusted. This is a receiver-side strip local to the
browser; it is never signalled to the participant or written to the server. The range
keeps its native arrow-key behaviour and is never offered on the local user's own row.
The volume, the gate and the noise removal for a person are remembered in this browser
for the signed-in account, so the one who chews is still gated tomorrow; a person set
back to defaults leaves no entry behind.

The arrows beside microphone and camera are the fast path for in-call quality.
Their compact drawers show the active profile and concrete bitrate or resolution,
keep selection rows accessible as radio groups, and link to full device settings.

The microphone gate is on by default and shares the speech detector with the
speaking ring, so what the ring shows and what the others hear can never
disagree. It opens on pitch, not on loudness: a vowel repeats itself 60–400
times a second and a crunch, a breath or a keystroke does not, so the gate has
nothing to open for however loud they are, and once open it closes after
600 ms without a vowel whatever the energy. Only the top of the sensitivity dial,
where the person asked for whispers, drops the pitch requirement. It opens with
80 ms of lookahead rather than on the first loud frame, so the consonant before
the first vowel is not cut. A person can also gate any other participant
locally — "Gate" beside that person's volume — and run that one strip through
a local suppressor — "Noise removal" — because the one who chews is rarely the one
who changes their settings.

Automatic volume is the pipeline's own leveller, not the platform's AGC. It
learns the level only from frames the detector marked voiced, steers them to a
fixed target at 6 dB a second (and back down at 40) and guards peaks before they clip, so it
can never turn the room up between sentences — the platform AGC does exactly
that, and is used only when the graph cannot be built, which the panel says. A
fixed microphone gain from −12 to +24 dB sits in front of everything, applied
live, for the headset that is too quiet.

Screen quality uses the same familiar select vocabulary as audio quality. Four
persistent presets state resolution, frame rate and approximate upstream cost:
720p15, 1080p30, 1440p30 and 2160p60. A change applies to an active share without
opening the system picker again. Ultra also states that mesh sends its bitrate to
each participant, so the cost is not hidden.

The compact drawer under the screen-share arrow exposes the same four presets
during a call. Every profile is available in every channel; screen quality is
a local sender preference and changes apply to an active share immediately.

Degraded states are stated where the setting is, in plain language: if a local
suppressor was asked for and could not start, or the gate could not be built,
the panel says so and the call carries on with browser suppression. The dock stays
quiet: it states link quality and latency once, next to "Connected".

Starting a screen share calls `getDisplayMedia` synchronously in the same click stack, so
browser user-activation is preserved.

### The speaking indicator is a timing contract

The accent ring is the only thing on screen that moves without a user action, so what
drives it is a design decision as much as an implementation one.

| Property | Value | Why the interface needs it |
| --- | --- | --- |
| Attack | 30 ms (3 frames) | The ring must be lit by the time the first word is audible, or it reads as lag |
| Hangover | 250–450 ms, 370 ms at the default sensitivity | Holds through the gaps between syllables; without it the ring strobes once per word, which is exactly the decorative motion §8 forbids |
| Decision basis | Signal-to-noise against a continuously tracked noise floor, plus periodicity for the onset | A fixed threshold is wrong in every room: it strobes in a quiet room with a hot mic and never fires next to a fan; and loudness alone cannot tell a vowel from a crunch, which is why the ring must not light for one |
| Warm-up | 120 ms after a stream attaches | The estimator has to hear the room before it may judge it; nothing lights during this window |
| Level | 8 discrete steps, published at most 10 times a second | Anything finer is jitter the eye reads as noise |
| Sensitivity | 0–100, mapped to 14→3 dB SNR | One dial, because every other value is a consequence of it; hysteresis and hangover follow automatically |

The detector runs on the audio render thread and only wakes the interface when the
result actually changes, so a lit ring costs a handful of updates per second rather than
a hundred. Muted participants report no level at all: a muted microphone is silence, and
silence must never animate.

### Haptics

Haptic feedback is a quiet, mobile-only progressive enhancement. It acknowledges only
four deliberate actions: sending a message, joining a voice channel, leaving a call and
toggling the microphone. Send and microphone use the 8 ms `selection` cue; join and leave
use the single 15 ms `light` cue. Navigation, pickers, reactions and ordinary controls do
not vibrate. Missing device or browser support is silent and never blocks the action.

## 9. Accessibility contract

Target WCAG 2.2 AA. Text contrast is tested at 4.5:1 for every preset (§4), and the
high-contrast setting raises text and lines further.

- Landmarks: the rail and the server column are `<nav>` elements and the roster is an
  `<aside>`, each with an `aria-label`; the room is `<main>`.
- A closed drawer or panel is `inert`, so it leaves the tab order and the accessibility
  tree rather than being merely invisible. Dialogs trap focus, close on `Esc`, and
  return focus to the control that opened them; `Esc` also closes an open drawer.
- Focus is never removed, only restyled. The global `:focus-visible` rule draws a 2px
  ring, and a control that styles its own focus, such as the composer box, still shows it.
- All icon-only buttons carry `aria-label`; toggles use `aria-pressed`; the active
  channel uses `aria-current="page"`.
- Live regions: transcript `polite`; voice status `polite`; send and upload failures
  `role="alert"`. Nothing is announced twice.
- Pictures that carry meaning have `alt`; decorative glyphs are `aria-hidden` with the
  meaning in adjacent text.
- Nothing depends on hover to be discoverable — every hover affordance has a
  keyboard-focus equivalent.
- Zoom to 200% at 1280px must not clip text or cause horizontal scrolling.

## 10. Implementation rules

- Plain CSS files in `web/src/styles/`, imported in one order by `web/src/app/globals.css`, in
  cascade layers. Tailwind supplies the reset and the layers, and `web/src/styles/theme.css`
  maps the tokens onto its namespaces; the components use their own class names rather
  than utility classes. Two CSS Modules exist: the account screens
  (`web/src/components/auth/AuthFrame.module.css`) and the loading skeleton
  (`web/src/app/AppSkeleton.module.css`). No UI framework and no CSS-in-JS runtime. The
  not-found page uses the global classes instead of a module: Next keeps the 404 boundary
  in the tree for every route and preloads its stylesheet, so a module there would be a
  chunk downloaded on every page and used on almost none — a real "preloaded but not
  used" console warning.
- Tokens are CSS custom properties on `:root`. Components take their colours from
  the semantic tokens (`--surface-*`, `--text-*`, `--line-*`, `--accent-*`), never from a
  preset's own values, and a raw color literal in a `.module.css` file is a defect. A few
  veils, scrims and shadows in the component sheets are written as literal `oklch()`
  values.
- The RTC layer sits behind the `VoiceClient` interface; no component imports
  `RTCPeerConnection` or `@microsoft/signalr` directly.
- `next/image` is avoided for user uploads (an unknown self-hosted origin); plain `<img>`
  with `loading="lazy"` is used instead.
