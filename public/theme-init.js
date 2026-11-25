// Apply the saved theme, or the OS preference, before the first paint.
// The storage key and fallback mirror src/lib/theme.ts.
(() => {
  try {
    const stored = localStorage.getItem("bookdrop-theme");
    document.documentElement.classList.toggle(
      "dark",
      stored
        ? stored === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
  } catch {
    // Storage or matchMedia unavailable; the app sets the theme after load.
  }
})();
