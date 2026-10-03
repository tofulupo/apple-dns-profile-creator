/**
 * The inline script in `pages/_prepaint.html` also applies `data-theme`,
 * reading the same storage key.
 */

import { desktopBindings } from "./desktop.ts";
import { browserStorage, type StorageArea, THEME_KEY } from "./storage.ts";

export { THEME_KEY };

export type Theme = "system" | "light" | "dark";

const ORDER: readonly Theme[] = ["system", "light", "dark"];

const LABELS: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export function readTheme(storage: Pick<Storage, "getItem">): Theme {
  try {
    const stored = storage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function nextTheme(theme: Theme): Theme {
  return ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] ?? "system";
}

function saveTheme(storage: StorageArea, theme: Theme): void {
  try {
    if (theme === "system") storage.removeItem(THEME_KEY);
    else storage.setItem(THEME_KEY, theme);
  } catch {
    // Not persisting is acceptable; the switch still works for this page.
  }
}

function syncThemeColor(theme: Theme): void {
  const background = getComputedStyle(document.body).backgroundColor;
  for (
    const meta of document.querySelectorAll<HTMLMetaElement>(
      'meta[name="theme-color"]',
    )
  ) {
    meta.dataset["system"] ??= meta.content;
    meta.content = theme === "system"
      ? meta.dataset["system"] ?? meta.content
      : background;
  }
}

function describe(button: HTMLButtonElement, theme: Theme): void {
  const label = `Theme: ${LABELS[theme]}. Switch to ${
    LABELS[nextTheme(theme)]
  }.`;
  button.setAttribute("aria-label", label);
  button.title = label;
}

function tellApp(theme: Theme): void {
  desktopBindings()?.setAppearance?.(theme).catch((error) =>
    console.error("Could not set the app's appearance:", error)
  );
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  if (theme === "system") delete root.dataset["theme"];
  else root.dataset["theme"] = theme;
  void root.offsetWidth;
  requestAnimationFrame(() => root.classList.remove("theme-switching"));
}

export function chooseTheme(theme: Theme): void {
  applyTheme(theme);
  saveTheme(browserStorage(), theme);
  syncThemeColor(theme);
  tellApp(theme);
}

export function followThemeChanges(onChange: (theme: Theme) => void): void {
  addEventListener("storage", (event) => {
    if (event.key !== THEME_KEY && event.key !== null) return;
    const theme = readTheme(browserStorage());
    applyTheme(theme);
    syncThemeColor(theme);
    onChange(theme);
  });
}

export function enableThemeSwitch(button: HTMLButtonElement): void {
  let theme = readTheme(browserStorage());
  describe(button, theme);
  syncThemeColor(theme);
  tellApp(theme);

  const choose = (chosen: Theme): void => {
    theme = chosen;
    chooseTheme(theme);
    describe(button, theme);
  };
  button.addEventListener("click", () => choose(nextTheme(theme)));
  desktopBindings()?.onAppearanceChosen?.(choose).catch((error) =>
    console.error("Could not follow View > Appearance:", error)
  );
  followThemeChanges((chosen) => {
    theme = chosen;
    describe(button, theme);
  });
}
