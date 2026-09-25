/**
 * The header's theme switch: follow the system, or force light or dark.
 *
 * The choice is applied as `data-theme` on the root element. The inline script
 * in `pages/_layout.html` does that before first paint, reading the same
 * storage key; this module only handles switching and the toolbar colour.
 */

export type Theme = "system" | "light" | "dark";

/** Also hardcoded in the layout's inline script; the markup test checks both. */
export const THEME_KEY = "dns-mobileconfig:theme";

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

function saveTheme(storage: Storage, theme: Theme): void {
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

export function enableThemeSwitch(button: HTMLButtonElement): void {
  let theme = readTheme(localStorage);
  describe(button, theme);
  syncThemeColor(theme);

  button.addEventListener("click", () => {
    theme = nextTheme(theme);
    const root = document.documentElement;
    // Colours with a transition (the upload zone's background) would fade
    // while text flips at once, leaving it unreadable for a moment. Switch
    // everything in one frame instead.
    root.classList.add("theme-switching");
    if (theme === "system") delete root.dataset["theme"];
    else root.dataset["theme"] = theme;
    void root.offsetWidth;
    requestAnimationFrame(() => root.classList.remove("theme-switching"));
    saveTheme(localStorage, theme);
    describe(button, theme);
    syncThemeColor(theme);
  });
}
