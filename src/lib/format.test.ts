import { describe, expect, it } from "vitest";
import { formatBytes, initials } from "@/lib/format";

describe("formatBytes", () => {
  it("uses readable units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(10 * 1024)).toBe("10 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});

describe("initials", () => {
  it("skips articles and joining words", () => {
    expect(initials("The Time Machine")).toBe("TM");
    expect(initials("The Art of War")).toBe("AW");
    expect(initials("A Study in Scarlet")).toBe("SS");
    expect(initials("Of Mice and Men")).toBe("OM");
    expect(initials("On the Road")).toBe("OR");
  });

  it("keeps a single word and falls back when every word is small", () => {
    expect(initials("Metamorphosis")).toBe("M");
    expect(initials("The")).toBe("T");
    expect(initials("   ")).toBe("?");
  });
});
