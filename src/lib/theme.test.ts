// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initTheme, isDark, setDark } from "@/lib/theme";

/** Stand-in for `matchMedia`, with a way to flip the OS preference. */
function mockSystem(dark: boolean) {
  const listeners: Array<() => void> = [];
  let matches = dark;
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return matches;
    },
    addEventListener: (_event: string, listener: () => void) => {
      listeners.push(listener);
    },
  }));
  return (next: boolean) => {
    matches = next;
    for (const listener of listeners) listener();
  };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("initTheme", () => {
  it("follows the OS when no theme has been chosen", () => {
    mockSystem(true);
    initTheme();
    expect(isDark()).toBe(true);
  });

  it("keeps following OS changes until the user chooses", () => {
    const changeSystem = mockSystem(false);
    initTheme();
    changeSystem(true);
    expect(isDark()).toBe(true);
  });

  it("prefers a saved choice and ignores later OS changes", () => {
    localStorage.setItem("bookdrop-theme", "light");
    const changeSystem = mockSystem(true);
    initTheme();
    expect(isDark()).toBe(false);
    changeSystem(true);
    expect(isDark()).toBe(false);
  });
});

describe("setDark", () => {
  it("applies and persists the user's choice", () => {
    mockSystem(false);
    initTheme();
    setDark(true);
    expect(isDark()).toBe(true);
    expect(localStorage.getItem("bookdrop-theme")).toBe("dark");
  });
});
