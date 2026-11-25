import { describe, expect, it } from "vitest";
import { LAYOUT, WIDE_BREAKPOINT } from "@/lib/layout";

function columnsAt(windowWidth: number): number {
  const inner = windowWidth - LAYOUT.panelWidth - LAYOUT.gridPadX * 2;
  return Math.floor(
    (inner + LAYOUT.gridGapX) / (LAYOUT.cardWidth + LAYOUT.gridGapX),
  );
}

describe("WIDE_BREAKPOINT", () => {
  it("appears exactly when the reserved grid still fits four columns", () => {
    expect(columnsAt(WIDE_BREAKPOINT)).toBe(LAYOUT.minWideColumns);
    expect(columnsAt(WIDE_BREAKPOINT + 20)).toBeGreaterThanOrEqual(
      LAYOUT.minWideColumns,
    );
  });
});
