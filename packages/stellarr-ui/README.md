# @stellarr/ui

Components and helpers shared by the web client (`web/`) and Cockpit (`cockpit/`). The package is private and holds:

- `@stellarr/ui`: the components below and the `cx` class-name helper.
- `@stellarr/ui/styles.css`: the components' stylesheet.
- `@stellarr/ui/icons`: Stellarr's icon set, `Icon` and `ICON_PATHS`, the one registry both apps and [`branding/icons/`](../../branding/icons/) use. How to draw a glyph: [`src/icons/README.md`](src/icons/README.md).

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
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | One tab stop for the row, arrows to move and pick. Only the picked panel is mounted. `unstyled` leaves the look to the caller. |
| `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` | A table whose header sticks to the area that scrolls it. |
| `Dialog` + `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose`, `DialogTrigger` | A centred modal. |
| `Sheet` + `SheetContent` (`side`: `right`, `left`), `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetClose`, `SheetTrigger` | A modal along an edge. |
| `DropdownMenu` + `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSeparator` | A list of actions under a button. |
| `Tooltip` + `TooltipTrigger`, `TooltipContent` | A note for the pointer (after `delayDuration`, 300 ms) and the keyboard (at once). |
| `Spinner` | Work in progress, the icon set's open ring turning. |

What they share:

- Every part takes `className`, and a utility class there always wins over the package's own rule (see below).
- `asChild` on `Button` and on the triggers, `DialogClose` and `DropdownMenuItem` draws the one child element, such as an `<a>`, with the part's look and behaviour.
- No text is built in. `DialogContent` and `SheetContent` take a required `closeLabel` for the close button; everything else is named by the caller.
- Dialogs, sheets and menus are modal: the page behind is hidden from assistive tech and does not scroll, Tab stays inside, Escape closes the topmost one only, and focus goes back to what opened it. A menu item that opens a dialog hands it the focus and gets it back.
- Menus and tooltips place themselves beside the trigger, flip to the other side when only that one has room, and stay inside the window.

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

### Tokens

All look comes from custom properties, in two tiers. The stylesheet declares none of them.

**System tokens** are required. The app defines every one of them, usually as `var()` of its own palette, so they follow its light and dark schemes. They have no default here. Cockpit's mapping is in [`cockpit/src/index.css`](../../cockpit/src/index.css) and the web client's in [`web/src/styles/ui-tokens.css`](../../web/src/styles/ui-tokens.css).

| Token | Used for |
| --- | --- |
| `--ui-unit` | One design pixel. Every size of `Button` and `Switch` is a multiple of it, and 1 px borders stay 1 px |
| `--ui-page` | The page: sheets and tooltip text |
| `--ui-surface` | Cards, dialogs, an active tab, a table's sticky header |
| `--ui-surface-muted` | A neutral alert |
| `--ui-popover` | Menus |
| `--ui-hover` | Hovered `quiet` button, the highlighted menu item, the secondary badge, the switch's track when off |
| `--ui-text`, `--ui-text-muted`, `--ui-text-faint` | Text, secondary text such as descriptions, table headings and placeholders, and the switch's knob when off |
| `--ui-line` | Borders and separators |
| `--ui-line-field` | A text field's border |
| `--ui-line-strong` | The border of a hovered `secondary` button |
| `--ui-ring`, `--ui-ring-offset` | Focus rings, and the gap inside the close button's ring |
| `--ui-accent`, `--ui-accent-hover`, `--ui-on-accent` | The `primary` button, the switch when on, and text selection |
| `--ui-danger`, `--ui-on-danger` | The `danger-solid` button, and the border of a `danger` one |
| `--ui-danger-text`, `--ui-danger-soft` | The `danger` button, destructive menu items, badges and alerts, refused fields |
| `--ui-success-text`, `--ui-success-soft`, `--ui-warning-text`, `--ui-warning-soft` | Badges |
| `--ui-scrim` | Behind a dialog or a sheet |
| `--ui-elevation-low`, `--ui-elevation-menu`, `--ui-elevation-modal` | Shadows of tooltips, of menus, and of dialogs and sheets |
| `--ui-radius-xs` … `--ui-radius-xl` | Corners: the close button, menu items, fields and menus, alerts, cards and dialogs |
| `--ui-ease` | The easing of transitions |
| `--ui-dur-fast`, `--ui-dur-base` | The duration of colour changes, and of the switch's knob moving |

`--ui-unit` is a length. The web client sets `1px`. Cockpit sets `calc(1rem / 16)`, because it scales its root font size with the window on purpose, and a `Button` or a `Switch` scales with it. The other components size in `rem`.

**Component tokens** are optional. A part reads them as `--ui-<component>-<part>-<property>`, with `sm` for the small size, `on` for a checked switch and `hover` and `pressed` for those states of a button. Each is read with a fallback, which is the web client's look, so an app sets a token only where its own look differs. Cockpit is the one app that deviates, and sets what it needs in `cockpit/src/index.css`.

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
| `--ui-button-gap` | `0px` | The space between an icon and the label |
| `--ui-button-sm-gap` | `--ui-button-gap` | The same in the `sm` size |
| `--ui-button-icon-size` | `auto` | The width and height of an icon, which `auto` leaves at the size of its own attributes |
| `--ui-button-white-space` | `inherit` | Whether a label may wrap |
| `--ui-button-font-size` | `13` units | The label |
| `--ui-button-line-height` | `inherit` | The label's line |
| `--ui-button-font-weight` | `600` | The label |
| `--ui-button-padding-x` | `18` units | The space at both ends of the label |
| `--ui-button-sm-font-size`, `--ui-button-sm-line-height` | The tokens above | The label of the `sm` size |
| `--ui-button-sm-padding-x` | `14` units | The space at both ends of an `sm` label |
| `--ui-button-disabled-opacity` | `1`, and `0.4` for `secondary` | A disabled button |
| `--ui-button-secondary-border` | `--ui-line` | The outline |
| `--ui-button-secondary-bg` | `transparent` | The fill |
| `--ui-button-secondary-text` | `--ui-text-muted` | The label |
| `--ui-button-secondary-hover-border` | `--ui-line-strong` | The outline while hovered |
| `--ui-button-secondary-hover-bg` | `--ui-button-secondary-bg` | The fill while hovered |
| `--ui-button-secondary-pressed-border`, `--ui-button-secondary-pressed-bg` | The hovered values | A toggle that is on |
| `--ui-button-secondary-pressed-text` | `--ui-text` | A toggle that is on |
| `--ui-button-secondary-unpressed-text` | `--ui-button-secondary-text` | A toggle that is off |
| `--ui-button-danger-solid-border-width` | `1px` | The width of the transparent border of `danger-solid`, which keeps its base size level with an outlined sibling. `0px` for a button that sizes to its content |
| `--ui-button-danger-solid-hover-bg` | `--ui-danger` mixed 86% with white | The fill while hovered |
| `--ui-button-danger-solid-focus-shadow` | `--ui-focus-shadow` | The focus ring of the `danger-solid` variant |

A button changes under the pointer only where the pointer can hover, and never while disabled.

Both parts draw focus from three more tokens:

| Token | Fallback | Used for |
| --- | --- | --- |
| `--ui-focus-outline` | `2px solid var(--ui-ring)` | The outline. `none` turns it off |
| `--ui-focus-border` | The border colour the state already has | The border colour of a focused part |
| `--ui-focus-shadow` | `none` | A ring drawn as a shadow around the part |

An outline is the web client's focus. Cockpit's is a ring: the border takes the ring colour and a soft shadow surrounds it.

## Checks

Run these from the repository root, after `npm ci`:

```bash
npm run typecheck:ui
npm run test:ui
npm run icons:export -w @stellarr/ui -- --check
```
