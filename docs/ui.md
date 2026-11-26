# UI rules

Short version of the rules the front end follows. When a new screen disagrees
with one of these, change the screen, not the rule.

## Type

| Role | Size | Class |
| --- | --- | --- |
| Entity title (a book) | 20px | `text-xl` |
| Screen / dialog title | 18px | `text-lg` |
| Band heading | 16px | `text-base` |
| Body and controls | 14px | `text-sm` |
| Meta, helper, field label | 12px | `text-xs` |
| Eyebrow | 11px | `EYEBROW` |

Use `EYEBROW` for any uppercase label (section names, popover headers, option
sources). Use `FIELD_LABEL` above a form control. Do not add new one-off px
sizes; 11px is only for eyebrows and micro overlays on a cover.

The serif stack is reserved for the missing-cover monogram. It is not a second
heading font.

## Radius

| Surface | Radius |
| --- | --- |
| Inputs, buttons, covers, cards, chips, menus | 8px (`rounded-lg`) |
| Toasts | 10px (`rounded-xl`) |
| Dialogs | 12px (`rounded-2xl`) |
| Pills and badges | full |

Do not change a button's radius with its size.

## Spacing

- The app gutter is 20px: top bar, banners, footer, grid, panel, and dialog
  header/body/footer all use it.
- Control heights: 32px for forms and toolbars, 28px for compact rows, 24px
  for inline chips. Controls in one row share a height.

## Icons

Functional minimal. An icon is allowed when it aids scanning:

- toolbars and primary object action rows,
- primary object actions such as Open, Edit, Remove,
- file/data actions such as Upload, Refresh, or Choose folder in a primary CTA,
- tone and status indicators (toasts, cover badges),
- icon-only dismissal and close buttons.

An icon is not used for confirmations (Save, Cancel, Discard), links, or text
rows inside popovers. Never mix icon and no-icon buttons inside one group.
One icon per concept.

## Dialogs

Every dialog uses `DialogContent` + `DialogHeader` (+ `DialogFooter` when it
has actions). The header is 56px tall, the close button is 28px and offset by
`-mr-2` so the X glyph lines up optically with the 20px text gutter. Body
content owns its own `p-5` and scroll area.

## Review and narrow windows

The library review options live in one `Review` popover at every width, so the
top bar never depends on window width to fit.

Below `WIDE_BREAKPOINT` the book panel becomes an overlay drawer; its close
button floats on the scrim beside the panel, so the panel does not spend a
header row on a control the cover already dominates. The drawer is a modal:
the page behind it is inert, focus loops inside it, Escape closes it from any
field, and a child dialog (edit, remove, cover) takes over focus while open.
Arrow keys move focus between cards only; Enter, Space, or a click opens the
drawer. On wide screens the docked panel still follows the arrow selection.

## Empty states

Use `EmptyState`: `compact` for a panel or a filtered result, `full` when the
whole library is empty. Do not hand-roll another icon/title/action layout.

## Copy

- Ellipsis only when the action opens a dialog or folder picker.
- Recheck = verify a file or installation again.
- Retry = rerun a failed operation.
- Refresh online = fetch metadata and covers.
