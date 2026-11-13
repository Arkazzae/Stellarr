# @stellarr/ui

Components and helpers shared by the web client (`web/`) and Cockpit (`cockpit/`). The package is private and holds:

- `@stellarr/ui`: the components below and the `cx` class-name helper.
- `@stellarr/ui/styles.css`: the components' stylesheet.
- `@stellarr/ui/behavior`: the helpers the components are built from, for an overlay an app draws itself. See [Behaviour](#behaviour).
- `@stellarr/ui/icons`: Stellarr's icon family in two variants, linear and broken (the default): `Icon`, `IconVariantProvider`, `ICON_GLYPHS` and `iconPaths`, the one registry both apps and [`branding/icons/`](../../branding/icons/) use. How to draw a glyph: [`src/icons/README.md`](src/icons/README.md).

It is consumed as TypeScript source: `exports` points at `src/index.ts` and there is no build step. Next.js compiles it through `transpilePackages`, and Vite and Vitest compile it as part of the importing app.

Inside the package, import with relative paths. The `@/` aliases belong to the apps and do not resolve here. The package depends on nothing but React: no Radix, no clsx, no tailwind-merge.

## Components

| Export | What it is |
| --- | --- |
| `Button` | `variant`: `primary` (accent fill, the default), `secondary` (outlined), `quiet` (no border), `danger` (outlined in the danger colour), `danger-solid` (filled). `size`: `default`, `sm`, `icon`, `icon-sm`. A `secondary` button with `aria-pressed` is a toggle. |
| `Badge` | `variant`: `secondary`, `outline`, `success`, `warning`, `destructive`. |
| `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent` | A surface a step off the page. |
| `Alert`, `AlertTitle`, `AlertDescription` | A message that stays where it applies; `variant="destructive"` for a failure. |
| `Input`, `Label` | A text field and its visible name. `aria-invalid` draws the field as refused. |
| `Switch` | An on/off setting, `role="switch"`. Controlled with `checked` and `onCheckedChange`. |
| `Segmented` | A row of mutually exclusive choices, as a radio group: one tab stop, arrows, Home and End. Controlled with `options`, `value` and `onChange`. `variant`: `cards` (a grid of bordered cards, the default) or `pill` (one compact row in a rounded track, for short words). An option has a `label`, and optionally a `detail` second line, a `leading` mark, a `title` tooltip and a `tone`. |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | One tab stop for the row, arrows to move and pick. Only the picked panel is mounted. `unstyled` leaves the look to the caller. |
| `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` | A table whose header sticks to the area that scrolls it. |
| `Dialog` + `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose`, `DialogTrigger` | A centred modal. |
| `Sheet` + `SheetContent` (`side`: `right`, `left`), `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetClose`, `SheetTrigger` | A modal along an edge. |
| `Dropdown` | A single choice from a list, as a combobox with a listbox popup: one tab stop, arrows, Home and End, and typing to jump, as a `<select>` has. Controlled with `options`, `value` and `onChange`; named by `label`, or by `id` when a visible `<label for>` does it. `variant`: `field` (fills a form row, the default) or `quiet` (a bare control for a bar that is already boxed). An option has a `label`, and optionally a `detail` second line, an `icon`, a `lang` for a label in another language than the page's, and `disabled`. `placeholder` shows when the value names nothing in the list, and the field is empty without one. `name` submits the value with the form, `invalid` draws the field as refused, and `aria-describedby` points it at a hint. |
| `DropdownMenu` + `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSeparator` | A list of actions under a button. |
| `Tooltip` + `TooltipTrigger`, `TooltipContent` | A note for the pointer (after `delayDuration`, 300 ms) and the keyboard (at once). |
| `Spinner` | Work in progress, the icon set's open ring turning. |

What they share:

- Every part takes `className`, and a utility class there always wins over the package's own rule (see below).
- `asChild` on `Button` and on the triggers, `DialogClose` and `DropdownMenuItem` draws the one child element, such as an `<a>`, with the part's look and behaviour.
- No text is built in. `DialogContent` and `SheetContent` take a required `closeLabel` for the close button; everything else is named by the caller.
- Dialogs, sheets and menus are modal: the page behind is hidden from assistive tech and does not scroll, Tab stays inside, Escape closes the topmost one only, and focus goes back to what opened it. A menu item that opens a dialog hands it the focus and gets it back.
- Menus, tooltips and a dropdown's list place themselves beside the trigger, flip to the other side when only that one has room, and stay inside the window. The stylesheet takes the position from the private custom properties `--_x` and `--_y`, not from an inline `left` and `top`, so an app that draws a menu differently on a phone can override `left` and `top` through `className` under a media query.

## Styles

The stylesheet is plain CSS in the `components.ui` layer, which is nested in Tailwind's `components` layer. Import it right after Tailwind:

```css
@import "tailwindcss";
@import "@stellarr/ui/styles.css";
```

A layer outranks specificity, so a rule here loses to a utility in `className` whatever its specificity: `<Card className="gap-0 py-0">` simply overrides the card's gap and padding. It also loses to any rule the app writes in its own `components` layer, which is where an app puts the layout of a part without raising specificity. Classes are prefixed `ui-`; variants are `data-variant`, `data-size`, `data-side` and `data-state` attributes.

Apps never write selectors against `ui-*` classes. They pass `className` for layout and change a look through tokens. A region is re-skinned by setting component tokens on an ancestor:

```css
.confirm-footer {
  --ui-button-secondary-bg: var(--surface-overlay);
}
```

A different look for the same meaning is a token. A different meaning is a variant.

The `data-*` attributes a component publishes are part of its public surface, `data-tone` on a `Segmented` option included. An app may use them under a class of its own to set tokens, which is the same thing as setting them on an ancestor and not a selector against a `ui-*` class:

```css
.permission-pill [data-tone="deny"] {
  --ui-segmented-item-on-bg: var(--danger-soft);
}
```

### Tokens

All look comes from custom properties, in two tiers. The stylesheet declares none of them.

**System tokens** are required. The app defines every one of them, usually as `var()` of its own palette, so they follow its light and dark schemes. They have no default here. Cockpit's mapping is in [`cockpit/src/index.css`](../../cockpit/src/index.css) and the web client's in [`web/src/styles/ui-tokens.css`](../../web/src/styles/ui-tokens.css).

| Token | Used for |
| --- | --- |
| `--ui-unit` | One design pixel. Every size of every part is a multiple of it; 1 px borders and the 2 px to 4 px of a focus ring stay in px |
| `--ui-page` | The page: sheets and tooltip text |
| `--ui-surface` | Cards, dialogs, an active tab, a table's sticky header |
| `--ui-surface-muted` | A neutral alert, and the track of a `pill` |
| `--ui-popover` | Menus, and a `pill` segment that is hovered or checked |
| `--ui-hover` | Hovered `quiet` button, the highlighted menu item, the secondary badge, the switch's track when off |
| `--ui-text`, `--ui-text-muted`, `--ui-text-faint` | Text, secondary text such as descriptions, table headings, placeholders and the label of a card, and faint text such as the switch's knob when off, the label of an idle `quiet` button, the second line of a card and the label of an idle `pill` segment |
| `--ui-line` | Borders and separators |
| `--ui-line-subtle` | The border of a card that is neither hovered nor checked, and of a `pill`'s track |
| `--ui-line-field` | A text field's border |
| `--ui-line-strong` | The border of a hovered `secondary` button and of a hovered card |
| `--ui-ring`, `--ui-ring-offset` | Focus rings, and the gap inside the close button's ring |
| `--ui-accent`, `--ui-accent-hover`, `--ui-on-accent` | The `primary` button, the switch when on, the border and tint of a checked card, and text selection |
| `--ui-danger`, `--ui-on-danger` | The `danger-solid` button, and the border of a `danger` one |
| `--ui-danger-text`, `--ui-danger-soft` | The `danger` button, destructive menu items, badges and alerts, refused fields |
| `--ui-success-text`, `--ui-success-soft`, `--ui-warning-text`, `--ui-warning-soft` | Badges |
| `--ui-scrim` | Behind a dialog or a sheet |
| `--ui-elevation-low`, `--ui-elevation-menu`, `--ui-elevation-modal` | Shadows of tooltips, of menus, and of dialogs and sheets |
| `--ui-radius-xs`, `--ui-radius-sm`, `--ui-radius-md`, `--ui-radius-lg`, `--ui-radius-xl` | Corners: the close button, menu items and the icon sizes of `Button`, fields and menus, alerts, cards and dialogs |
| `--ui-ease` | The easing of transitions |
| `--ui-dur-fast`, `--ui-dur-base` | The duration of colour changes, and of the switch's knob moving |

`--ui-unit` is a length. The web client sets `1px`. Cockpit sets `calc(1rem / 16)`, because it scales its root font size with the window on purpose, and every part scales with it. The one length the package keeps in `rem` is the breakpoint of a media query, which cannot read a custom property.

**Component tokens** are optional. A part reads them as `--ui-<component>-<part>-<property>`, with `sm` for the small size, `on` for a checked switch or segment, and `hover` and `pressed` for those states of a button. Each is read with a fallback, which is the web client's look, so an app sets a token only where its own look differs. Cockpit is the one app that deviates, and sets what it needs in `cockpit/src/index.css`.

The tables show each fallback. A fallback that names another token follows it, so an app that sets the first changes the second too.

`Switch`:

| Token | Fallback | Used for |
| --- | --- | --- |
| `--ui-switch-w`, `--ui-switch-h` | `44` and `26` units | The track |
| `--ui-switch-bg` | `--ui-hover` | The track when off |
| `--ui-switch-border` | `--ui-line` | The track's border when off |
| `--ui-switch-on-bg` | `--ui-accent` | The track when on |
| `--ui-switch-on-border` | `--ui-accent` | The track's border when on |
| `--ui-switch-thumb-size` | `20` units | The knob's diameter |
| `--ui-switch-thumb-bg` | `--ui-text-faint` | The knob when off |
| `--ui-switch-thumb-on-bg` | `--ui-on-accent` | The knob when on |
| `--ui-switch-thumb-align` | `flex-start` | `align-items` of the track: where the knob sits across it. `center` centres it |
| `--ui-switch-thumb-y` | `2` units | The knob's distance from the top of the track's padding box. `0px` when the knob is centred |
| `--ui-switch-thumb-shadow` | `none` | The knob's shadow |
| `--ui-switch-thumb-x` | `2` units | The knob's distance from the inside of the track's left edge when off |
| `--ui-switch-thumb-on-x` | `20` units | The same distance when on |
| `--ui-switch-disabled-opacity` | `1` | A disabled switch |
| `--ui-switch-hit-inset` | `0` | How far the press area reaches past the track, as an `inset` value. An app on a touch screen sets a negative block value |

`Button`:

| Token | Fallback | Used for |
| --- | --- | --- |
| `--ui-button-min-height` | `auto` | The least height, which a touch screen raises |
| `--ui-button-gap` | `normal` | The space between an icon and the label |
| `--ui-button-sm-gap` | `--ui-button-gap` | The same in the `sm` size |
| `--ui-button-icon-size` | `auto` | The width and height of an icon, which `auto` leaves at the size of its own attributes |
| `--ui-button-white-space` | `inherit` | Whether a label may wrap |
| `--ui-button-font-size` | `13` units | The label |
| `--ui-button-line-height` | `inherit` | The label's line |
| `--ui-button-font-weight` | `600` | The label |
| `--ui-button-padding-x` | `18` units | The space at both ends of the label |
| `--ui-button-sm-font-size`, `--ui-button-sm-line-height` | The tokens above | The label of the `sm` size |
| `--ui-button-sm-padding-x` | `14` units | The space at both ends of an `sm` label |
| `--ui-button-icon-only-radius` | `--ui-radius-sm` | The corners of the `icon` and `icon-sm` sizes. A pill is `calc(infinity * 1px)` |
| `--ui-button-icon-only-min-width` | `auto` | The least width of the `icon` and `icon-sm` sizes, which a touch screen raises along with `--ui-button-min-height` |
| `--ui-button-disabled-opacity` | `1`, and `0.4` for `secondary` | A disabled button |
| `--ui-button-primary-bg` | `--ui-accent` | The fill of `primary`, while it is not hovered |
| `--ui-button-secondary-border` | `--ui-line` | The outline |
| `--ui-button-secondary-bg` | `transparent` | The fill |
| `--ui-button-secondary-text` | `--ui-text-muted` | The label |
| `--ui-button-secondary-hover-border` | `--ui-line-strong` | The outline while hovered |
| `--ui-button-secondary-hover-bg` | `--ui-button-secondary-bg` | The fill while hovered |
| `--ui-button-secondary-hover-text` | `--ui-text` | The label while hovered |
| `--ui-button-secondary-pressed-border`, `--ui-button-secondary-pressed-bg` | The hovered values | A toggle that is on |
| `--ui-button-secondary-pressed-text` | `--ui-text` | A toggle that is on |
| `--ui-button-secondary-unpressed-text` | `--ui-button-secondary-text` | A toggle that is off |
| `--ui-button-quiet-text` | `--ui-text-faint` | The label of `quiet`, while it is not hovered. `currentColor` takes it from the surroundings |
| `--ui-button-quiet-hover-bg` | `--ui-hover` | The fill of `quiet` while hovered |
| `--ui-button-quiet-hover-text` | `--ui-text` | The label of `quiet` while hovered |
| `--ui-button-danger-solid-border-width` | `1px` | The width of the transparent border of `danger-solid`, which keeps its base size level with an outlined sibling. `0px` for a button that sizes to its content |
| `--ui-button-danger-solid-hover-bg` | `--ui-danger` mixed 86% with white | The fill while hovered |
| `--ui-button-danger-solid-focus-shadow` | `--ui-focus-shadow` | The focus ring of the `danger-solid` variant |

A button changes under the pointer only where the pointer can hover, and never while disabled.

`Segmented`. Each variant draws its own look completely; these tokens only place it:

| Token | Fallback | Used for |
| --- | --- | --- |
| `--ui-segmented-columns` | `1fr 1fr` | `grid-template-columns` of the group |
| `--ui-segmented-gap` | `10` units | The space between cards. A `pill` has none |
| `--ui-segmented-item-gap` | `4` units | The space between a card's label, leading mark and second line |
| `--ui-segmented-item-padding` | `13` and `15` units | The space inside a card |
| `--ui-segmented-item-font-size` | `14` units | A card's label |
| `--ui-segmented-item-text` | `--ui-text-muted` | The label of a card that is neither hovered nor checked. A `pill` segment draws its own and has no token |
| `--ui-segmented-item-on-bg` | `--ui-accent` mixed 12% with transparent for `cards`, `--ui-popover` for `pill` | The fill of the checked segment |
| `--ui-segmented-item-on-text` | `--ui-text` | The label of the checked segment |
| `--ui-segmented-detail-text` | `--ui-text-faint` | A segment's second line. An app whose second line is a sentence to read, not a figure to glance at, raises its contrast |

A card's label turns `--ui-text` under the pointer whatever `--ui-segmented-item-text` is, and the checked card takes `--ui-segmented-item-on-text` after it. A segment answers the pointer even while it is disabled, and whether or not the pointer can hover, except in a `pill`, where only a segment that can be pressed lights up. The checked segment keeps its look under the pointer. A segment's second line is 12 units. An app that colours the checked segment by meaning sets the two `on` tokens under a selector on `data-tone`, as in the note on `data-*` attributes above.

`Dropdown`. A `quiet` field draws its own look completely; of these only the least height, the widest width and the corner radius reach it. The list is drawn in `<body>`, outside whatever region sets a token, so the tokens only it reads (`--ui-dropdown-tick-text`, the two `--ui-dropdown-option-*` and the three `--ui-dropdown-list-*`) take effect from `:root` or `body` and from nowhere below, and `--ui-dropdown-font-size` reaches its options from there alone:

| Token | Fallback | Used for |
| --- | --- | --- |
| `--ui-dropdown-min-height` | `42` units, and `28` for `quiet` | The least height of the field, which a touch screen raises |
| `--ui-dropdown-max-width` | `320` units, and `200` for `quiet` | The widest the field gets. `100%` lets it fill its column |
| `--ui-dropdown-padding` | `9`, `10`, `9` and `14` units | The space inside the field |
| `--ui-dropdown-radius` | `--ui-radius-md` | The corners of the field |
| `--ui-dropdown-bg` | `--ui-surface-muted` | The fill of the field |
| `--ui-dropdown-border` | `--ui-line-subtle` | The border of the field while it is neither hovered nor open |
| `--ui-dropdown-hover-border` | `--ui-line` | The border of the field while it is hovered |
| `--ui-dropdown-font-size` | `14` units | The chosen value in the field and the label of each option |
| `--ui-dropdown-tick-text` | `--ui-accent` | The tick on the chosen option. The web client sets its accent as text, which is mixed differently from the accent as a fill |
| `--ui-dropdown-option-min-height` | `auto` | The least height of an option, which a touch screen raises |
| `--ui-dropdown-option-padding-y` | `8` units | The space above and below an option's text |
| `--ui-dropdown-list-bg` | `--ui-surface` | The fill of the list |
| `--ui-dropdown-list-border` | `none` | The border of the list, as a whole `border` value such as `1px solid var(--ui-line)` |
| `--ui-dropdown-list-z-index` | `98` | Where the list stacks: above the web client's settings dialog and media viewer, below its confirmation dialog. The package's other overlays are at 50 |

A field refused with `invalid` takes `--ui-danger-text` as its border, as an `Input` does, in every state.

The button, the switch, the segments and the dropdown field draw focus from three more tokens:

| Token | Fallback | Used for |
| --- | --- | --- |
| `--ui-focus-outline` | `2px solid var(--ui-ring)` | The outline. `none` turns it off |
| `--ui-focus-border` | The border colour the state already has | The border colour of a focused part |
| `--ui-focus-shadow` | `none` | A ring drawn as a shadow around the part |

An outline is the web client's focus. Cockpit's is a ring: the border takes the ring colour and a soft shadow surrounds it.

A custom property fails silently, so `npm run tokens:check -w @stellarr/ui` guards both tiers. It fails when an app lacks a system token, when an app defines a `--ui-*` token the package never reads (a typo of a component token would otherwise leave the default look in place without a sign), and when a token the package reads is missing from the tables above.

## Behaviour

`@stellarr/ui/behavior` exports the helpers the components are built from. An overlay an app draws itself (a modal, a popover, a context menu) uses them to share one layer stack with the package's: one Escape closes one layer, a press outside reaches one layer, and the page behind is hidden and locked once, however many layers are open. Like the components, these are for the client: the hooks need `"use client"`.

| Export | What it does |
| --- | --- |
| `useLayer(active, layer)` | Puts a layer on the stack while `active`. `layer` has `node` (its element) and optionally `owns`, `onEscape`, `onTab` and `onPointerDownOutside`. The `Layer` type |
| `hideOthers(keep)` | Hides every other child of `<body>` from assistive tech, counted per element, and returns the undo. The overlay has to be rendered into `<body>` |
| `lockScroll(areas)` | Stops the page from scrolling except inside `areas()`, and returns the undo. Locks nest |
| `allowScroll(areas)` | Lets the elements `areas()` returns scroll while a `lockScroll` is on, without taking a lock itself, and returns the undo. For a layer drawn outside the element that locked the page, such as the list a `Dropdown` opens from a `Dialog` |
| `lockPointer()` | Makes the page ignore the pointer, so a press beside a menu only closes it, and returns the undo. Locks nest |
| `usePresence(open)` | Keeps an element mounted while its exit animation runs. Returns `present` and a `ref` |
| `focusFirst(container)` | Focuses the first tab stop that is not a link, or the container |
| `trapTab(event, container, options)` | Wraps a Tab press at both ends of the container, and brings a Tab from outside back to its first stop unless `options.reclaim` is `false` |
| `FOCUSABLE` | The selector for a tab stop |
| `place(anchor, size, view, options)` | Where a floating element goes beside its anchor: the asked side, flipped when only the other has room, kept inside the window. `options` is a `PlaceOptions` of `side`, `align` and `offset`; `Side` and `Align` are its types. Returns a `Placement` |
| `measure(element)` | The element's laid-out size, unaffected by a transform |
| `snap(value)` | Rounds a length to a device pixel |
| `useControllableState(options)` | A value the parent may own or leave to the component |
| `Slot` | Renders its one child with its own props merged in, for `asChild` |
| `composeRefs(...refs)`, `useComposedRefs(...refs)` | Points several refs at one node; the hook keeps the callback stable between renders |

Escape and Tab go to the topmost layer that has a handler for them. They are heard in the bubble phase, so a control inside a layer that handles Escape itself (an inline editor that cancels, a search field that clears) keeps the key by calling `preventDefault()`, and the layer stays open. Preventing the default is the signal, not stopping the event: the stack listens on `document`, and in an app whose React root is the document itself, as with Next.js, React's handlers run on that same node, where a stopped event still reaches the stack. When a layer takes an Escape, the stack stops the event, so a `window` handler does not also act on it. An `onEscape` that returns `false` passes: the next layer down that has `onEscape` is asked, and when every layer passes the key goes on to the page. A side panel that stays open under a dialog passes whenever a dialog is in front of it, even if the panel joined the stack later.

A press goes to the topmost layer that has `onPointerDownOutside`, and to that layer alone. A layer above it with no such handler, such as a tooltip, is skipped. A press is outside when it lands beyond `node()`. A layer whose element is not the whole answer gives `owns(target)` instead, and it decides alone: a dialog whose wrapper is also its backdrop, or a panel whose trigger toggles it. A layer that hears no presses returns `null` from `node`.

`trapTab` suits a modal layer, where the focus never leaves. For a panel beside which the page still works, pass `{ reclaim: false }`: a Tab pressed while the focus is outside the panel is left to the browser, and the panel still wraps at its ends.

A popover joins the stack with `useLayer`, and the layers below it stay quiet while it is open:

```tsx
"use client";

import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLayer } from "@stellarr/ui/behavior";

export function Popover({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayer(open, {
    node: () => ref.current,
    onEscape: onClose,
    onPointerDownOutside: onClose,
  });

  return open ? createPortal(<div ref={ref}>{children}</div>, document.body) : null;
}
```

Opened from a `Dialog`, this popover closes alone on Escape and on a press outside, and the dialog stays open. A modal that also hides the page and keeps it from scrolling calls `hideOthers` and `lockScroll` in an effect, and returns their undo functions from it.

## Checks

Run these from the repository root, after `npm ci`:

```bash
npm run typecheck:ui
npm run test:ui
npm run icons:build -w @stellarr/ui -- --check
npm run tokens:check -w @stellarr/ui
```
