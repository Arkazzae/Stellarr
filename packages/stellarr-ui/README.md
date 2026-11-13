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
| `Button` | `variant`: `default` (accent fill), `outline`, `ghost`, `destructive`. `size`: `default`, `sm`, `icon`, `icon-sm`. An `outline` button with `aria-pressed` is a toggle. |
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

The stylesheet is plain CSS in Tailwind's `components` layer. Import it right after Tailwind:

```css
@import "tailwindcss";
@import "@stellarr/ui/styles.css";
```

Being in a layer below `utilities`, a rule here loses to any utility in `className` whatever its specificity, so `<Card className="gap-0 py-0">` simply overrides the card's gap and padding. Classes are prefixed `ui-`; variants are `data-variant`, `data-size`, `data-side` and `data-state` attributes.

### Tokens

The stylesheet reads only these custom properties and declares none of them. The app defines all of them, usually as `var()` of its own palette, so they follow its light and dark schemes. Cockpit's mapping is in [`cockpit/src/index.css`](../../cockpit/src/index.css).

| Token | Used for |
| --- | --- |
| `--ui-page` | The page: sheets, outline buttons, the switch's knob, tooltip text |
| `--ui-surface` | Cards, dialogs, an active tab, a table's sticky header |
| `--ui-surface-muted` | A neutral alert |
| `--ui-popover` | Menus |
| `--ui-hover` | Hovered ghost and outline buttons, the highlighted menu item, a pressed toggle, the secondary badge |
| `--ui-text`, `--ui-text-muted` | Text, and secondary text such as descriptions, table headings and placeholders |
| `--ui-line` | Borders and separators |
| `--ui-line-field` | A text field's border and the switch's track when off |
| `--ui-ring`, `--ui-ring-offset` | Focus rings, and the gap inside the close button's ring |
| `--ui-accent`, `--ui-accent-hover`, `--ui-on-accent` | The primary button and text selection |
| `--ui-danger`, `--ui-on-danger` | The destructive button |
| `--ui-danger-text`, `--ui-danger-soft` | Destructive menu items, badges and alerts, refused fields |
| `--ui-success-text`, `--ui-success-soft`, `--ui-warning-text`, `--ui-warning-soft` | Badges |
| `--ui-scrim` | Behind a dialog or a sheet |
| `--ui-elevation-low`, `--ui-elevation-menu`, `--ui-elevation-modal` | Shadows of the switch's knob and tooltips, of menus, and of dialogs and sheets |
| `--ui-radius-xs` … `--ui-radius-xl` | Corners: the close button, menu items, fields and menus, alerts, cards and dialogs |
| `--ui-ease` | Colour and opacity transitions |

Sizes are in `rem`, so an app that scales its root font size, as Cockpit does with the window, scales the components with it.

## Checks

Run these from the repository root, after `npm ci`:

```bash
npm run typecheck:ui
npm run test:ui
npm run icons:export -w @stellarr/ui -- --check
```
