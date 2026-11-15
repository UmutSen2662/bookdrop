/**
 * Layout numbers shared by the grid and the read panel.
 *
 * The panel is reserved only when the grid would still fit four cards per row
 * with the panel taking space. The breakpoint is derived here instead of being
 * a magic media query, so changing the panel width, card minimum, gaps, or grid
 * padding moves it automatically.
 */
export const LAYOUT = {
  panelWidth: 400,
  gridPadX: 24,
  gridGapX: 20,
  gridGapY: 28,
  cardMinWidth: 136,
  minWideColumns: 4,
  /** Windows' classic scrollbar takes width inside the grid's scroller. */
  scrollbarAllowance: 20,
} as const;

/**
 * panel + both grid paddings + four card minimums + three column gaps + a
 * scrollbar allowance. 400 + 48 + 544 + 60 + 20 = 1072 px today.
 *
 * At this width the wide grid has four columns even with the scrollbar; below
 * it the panel overlays and the grid uses the full window.
 */
export const WIDE_BREAKPOINT =
  LAYOUT.panelWidth +
  LAYOUT.gridPadX * 2 +
  LAYOUT.minWideColumns * LAYOUT.cardMinWidth +
  (LAYOUT.minWideColumns - 1) * LAYOUT.gridGapX +
  LAYOUT.scrollbarAllowance;
