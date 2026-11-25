const STORAGE_KEY = "bookdrop-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

type ThemeListener = (dark: boolean) => void;
const listeners = new Set<ThemeListener>();

function storedDark(): boolean | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "dark") return true;
    if (value === "light") return false;
    return null;
  } catch {
    return null;
  }
}

function apply(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
  for (const listener of listeners) listener(dark);
}

export function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

export function setDark(dark: boolean): void {
  apply(dark);
  try {
    localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
  } catch {
    // The toggle still works when storage is unavailable.
  }
}

export function subscribeTheme(listener: ThemeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Follow the OS until the user picks a theme with the top-bar toggle. */
export function initTheme(): void {
  const media = window.matchMedia(DARK_QUERY);
  apply(storedDark() ?? media.matches);
  media.addEventListener("change", () => {
    if (storedDark() === null) apply(media.matches);
  });
}
