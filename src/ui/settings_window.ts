import type { ForgetState } from "../desktop/bindings.ts";
import { desktopBindings } from "./desktop.ts";
import { signalPageReady } from "./page_ready.ts";
import {
  chooseMotion,
  enableSettings,
  type Motion,
  readSettings,
  reportMotion,
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

export const FORGET_NEXT_START =
  "Starts with the next launch. What's stored now is deleted when you quit.";
export const KEEP_NEXT_START =
  "Starts with the next launch. Until then, nothing is kept.";

/** What the note under "Forget everything when quitting" says, if anything. */
export function forgetNote(state: ForgetState): string | undefined {
  if (state.stored === state.active) return undefined;
  return state.stored ? FORGET_NEXT_START : KEEP_NEXT_START;
}

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

async function enableForget(): Promise<void> {
  const bindings = desktopBindings();
  const toggle = document.getElementById("forgetChk");
  const note = document.getElementById("forgetNote");
  if (
    typeof bindings?.forgetOnQuit !== "function" ||
    typeof bindings.setForgetOnQuit !== "function" ||
    !(toggle instanceof HTMLInputElement) || note === null
  ) {
    return;
  }
  const save = bindings.setForgetOnQuit;
  let state = await bindings.forgetOnQuit();
  const show = (): void => {
    toggle.checked = state.stored;
    const text = forgetNote(state);
    note.textContent = text ?? "";
    note.hidden = text === undefined;
  };
  show();
  toggle.disabled = false;
  toggle.addEventListener("change", () => {
    state = { ...state, stored: toggle.checked };
    show();
    save(toggle.checked).catch((error) =>
      console.error("Could not save the setting:", error)
    );
  });
}

function init(): void {
  const storage = browserStorage();
  const applySettings = enableSettings((motion) => check("motion", motion));

  check("theme", readTheme(storage));
  for (const radio of radios("theme")) {
    radio.addEventListener("change", () => {
      if (THEMES.includes(radio.value)) chooseTheme(radio.value as Theme);
    });
  }
  followThemeChanges((theme) => check("theme", theme));
  desktopBindings()?.onAppearanceChosen?.((theme) => {
    chooseTheme(theme);
    check("theme", theme);
  }).catch((error) => console.error("Could not follow the theme:", error));

  check("motion", readSettings(storage).motion);
  for (const radio of radios("motion")) {
    radio.addEventListener("change", () => {
      if (!MOTIONS.includes(radio.value)) return;
      const motion = radio.value as Motion;
      chooseMotion(storage, motion);
      applySettings();
      reportMotion(motion);
    });
  }
  addEventListener("storage", (event) => {
    if (event.key === SETTINGS_KEY || event.key === null) {
      check("motion", readSettings(storage).motion);
    }
  });

  enableForget()
    .catch((error) => console.error("Could not read the setting:", error))
    .finally(signalPageReady);
}

if (typeof document !== "undefined") init();
