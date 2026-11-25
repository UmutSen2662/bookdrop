import { describe, expect, it } from "vitest";
import { isOutsideLibrary, normalizedFolder } from "@/lib/outside";

describe("normalizedFolder", () => {
  it("makes separators, casing, and trailing slashes comparable", () => {
    expect(normalizedFolder("C:\\Books\\")).toBe("c:/books");
    expect(normalizedFolder("C:/Books")).toBe("c:/books");
  });
});

describe("isOutsideLibrary", () => {
  it("accepts the configured folder in any spelling", () => {
    expect(
      isOutsideLibrary({ libraryPath: "C:\\Books\\a.epub" }, "C:/Books/"),
    ).toBe(false);
  });

  it("flags another folder, a subfolder, and another drive", () => {
    expect(
      isOutsideLibrary({ libraryPath: "D:\\Books\\a.epub" }, "C:/Books"),
    ).toBe(true);
    expect(
      isOutsideLibrary({ libraryPath: "C:\\Books\\Sub\\a.epub" }, "C:/Books"),
    ).toBe(true);
    expect(isOutsideLibrary({ libraryPath: "D:\\a.epub" }, "C:/Books")).toBe(
      true,
    );
  });

  it("does nothing without a path or a configured folder", () => {
    expect(isOutsideLibrary({ libraryPath: null }, "C:/Books")).toBe(false);
    expect(isOutsideLibrary({ libraryPath: "C:\\Books\\a.epub" }, "")).toBe(
      false,
    );
  });
});
