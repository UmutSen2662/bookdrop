const STORAGE_KEY = "bookdrop-theme";

export function isDark() {
  return document.documentElement.classList.contains("dark");
}

export function setDark(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
}

export function initTheme() {
  setDark(localStorage.getItem(STORAGE_KEY) === "dark");
}
