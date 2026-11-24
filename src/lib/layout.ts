/**
 * Layout numbers shared by the grid and the read panel.
 *
 * The panel is reserved only when the grid would still fit four cards per row
 * with the panel taking space. The breakpoint is derived here instead of being
 * a magic media query, so changing the panel width, card width, gaps, or grid
 * padding moves it automatically.
 */
export const LAYOUT = {
  /**
   * The whole app surface — grid column and panel together — stops growing
   * here and centers in the window. This keeps the panel attached to the grid
   * instead of drifting to the window edge on wide screens. At 1520 the
   * 1120px grid column holds six 160px cards with 12px to spare.
   */
  appMaxWidth: 1520,
  panelWidth: 400,
  gridPadX: 24,
  gridGapX: 20,
  gridGapY: 28,
  /**
   * Covers are a fixed width. A fluid `1fr` column would stretch each cover
   * until another column fits, so the largest covers would get smaller as the
   * window grows. Fixed tracks add a column instead and leave the remainder
   * on the right. 160 keeps four columns at the 800px minimum, five at 1360,
   * and six at the 1520 app cap.
   */
  cardWidth: 160,
  minWideColumns: 4,
} as const;

/**
 * panel + both grid paddings + four card widths + three column gaps.
 * 400 + 48 + 640 + 60 = 1148 px today.
 *
 * The scroll area's 10px overlay scrollbar sits inside the grid's 24px right
 * padding, so it does not consume a column's width. At this width the wide
 * grid has four columns; below it the panel overlays and the grid uses the
 * full window.
 */
export const WIDE_BREAKPOINT =
  LAYOUT.panelWidth +
  LAYOUT.gridPadX * 2 +
  LAYOUT.minWideColumns * LAYOUT.cardWidth +
  (LAYOUT.minWideColumns - 1) * LAYOUT.gridGapX;
