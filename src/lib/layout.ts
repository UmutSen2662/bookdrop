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
   * here and centers, so the panel stays attached to the grid on wide screens.
   */
  appMaxWidth: 1520,
  panelWidth: 400,
  gridPadX: 20,
  gridGapX: 20,
  gridGapY: 28,
  /**
   * Covers are a fixed width: a fluid `1fr` column would stretch every cover
   * until another column fits. Fixed tracks add a column instead and leave the
   * remainder on the right.
   */
  cardWidth: 160,
  minWideColumns: 4,
} as const;

/**
 * The narrowest window that still fits the panel beside four grid columns.
 * The overlay scrollbar sits inside the grid padding, so it costs no column.
 */
export const WIDE_BREAKPOINT =
  LAYOUT.panelWidth +
  LAYOUT.gridPadX * 2 +
  LAYOUT.minWideColumns * LAYOUT.cardWidth +
  (LAYOUT.minWideColumns - 1) * LAYOUT.gridGapX;
