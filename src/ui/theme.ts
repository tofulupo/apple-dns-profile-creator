/**
 * The header's theme switch: follow the system, or force light or dark.
 *
 * The choice is applied as `data-theme` on the root element. The inline script
 * in `pages/_layout.html` does that before first paint, reading the same
 * storage key; this module only handles switching and the toolbar colour.
 *
 * In the desktop app View > Appearance offers the same choice, and the app's
 * title bar, menus and dialogs follow it too.
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
    // Storage can throw when disabled; the system theme is the safe default.
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

/**
 * The toolbar colour comes from two media-dependent `theme-color` tags, which
 * a forced theme would contradict. Pin both to the page background then, and
 * restore their own values for the system theme.
 */
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

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  // Colours with a transition (the upload zone's background) would fade
  // while text flips at once, leaving it unreadable for a moment. Switch
  // everything in one frame instead.
  root.classList.add("theme-switching");
  if (theme === "system") delete root.dataset["theme"];
  else root.dataset["theme"] = theme;
  void root.offsetWidth;
  requestAnimationFrame(() => root.classList.remove("theme-switching"));
}

export function enableThemeSwitch(button: HTMLButtonElement): void {
  // Deferred lookup: reading the `localStorage` global itself throws when
  // storage is blocked, which the try blocks above would not catch.
  const storage = browserStorage();
  let theme = readTheme(storage);
  const desktop = desktopBindings();
  const tellApp = (chosen: Theme): void => {
    desktop?.setAppearance?.(chosen).catch((error) =>
      console.error("Could not set the app's appearance:", error)
    );
  };
  describe(button, theme);
  syncThemeColor(theme);
  tellApp(theme);

  const choose = (chosen: Theme): void => {
    theme = chosen;
    applyTheme(theme);
    saveTheme(storage, theme);
    describe(button, theme);
    syncThemeColor(theme);
    tellApp(theme);
  };
  button.addEventListener("click", () => choose(nextTheme(theme)));
  desktop?.onAppearanceChosen?.(choose).catch((error) =>
    console.error("Could not follow View > Appearance:", error)
  );
}
