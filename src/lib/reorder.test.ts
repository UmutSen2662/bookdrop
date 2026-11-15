import { describe, expect, it } from "vitest";
import { moveId } from "./reorder";

describe("moveId", () => {
  it("lands after the target when moving right", () => {
    expect(moveId([1, 2, 3], 1, 3)).toEqual([2, 3, 1]);
  });

  it("lands before the target when moving left", () => {
    expect(moveId([1, 2, 3], 3, 1)).toEqual([3, 1, 2]);
  });

  it("moves one step in either direction", () => {
    expect(moveId([1, 2, 3], 2, 3)).toEqual([1, 3, 2]);
    expect(moveId([1, 2, 3], 2, 1)).toEqual([2, 1, 3]);
  });

  it("ignores a drop on itself or an unknown id", () => {
    expect(moveId([1, 2, 3], 2, 2)).toEqual([1, 2, 3]);
    expect(moveId([1, 2, 3], 9, 2)).toEqual([1, 2, 3]);
  });
});
