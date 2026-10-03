import { signalPageReady } from "./page_ready.ts";
import {
  enableSettings,
  type Motion,
  readSettings,
  saveSettings,
  SETTINGS_KEY,
} from "./settings.ts";
import { browserStorage } from "./storage.ts";
import {
  chooseTheme,
  followThemeChanges,
  readTheme,
  type Theme,
} from "./theme.ts";

const THEMES: readonly string[] = ["system", "light", "dark"] satisfies Theme[];
const MOTIONS: readonly string[] = [
  "system",
  "reduce",
  "full",
] satisfies Motion[];

function radios(name: string): HTMLInputElement[] {
  return [
    ...document.querySelectorAll<HTMLInputElement>(
      `input[type="radio"][name="${name}"]`,
    ),
  ];
}

function check(name: string, value: string): void {
  for (const radio of radios(name)) radio.checked = radio.value === value;
}

function init(): void {
  const storage = browserStorage();
  const applySettings = enableSettings();

  check("theme", readTheme(storage));
  for (const radio of radios("theme")) {
    radio.addEventListener("change", () => {
      if (THEMES.includes(radio.value)) chooseTheme(radio.value as Theme);
    });
  }
  followThemeChanges((theme) => check("theme", theme));

  check("motion", readSettings(storage).motion);
  for (const radio of radios("motion")) {
    radio.addEventListener("change", () => {
      if (!MOTIONS.includes(radio.value)) return;
      try {
        saveSettings(storage, {
          ...readSettings(storage),
          motion: radio.value as Motion,
        });
      } catch (error) {
        console.error("Could not save the setting:", error);
      }
      applySettings();
    });
  }
  addEventListener("storage", (event) => {
    if (event.key === SETTINGS_KEY || event.key === null) {
      check("motion", readSettings(storage).motion);
    }
  });

  signalPageReady();
}

init();
