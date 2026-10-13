/**
 * pages/_prepaint.js also applies them before first paint, as
 * `data-motion="reduce"` on the root element.
 */

import { desktopBindings } from "./desktop.ts";
import { browserStorage, SETTINGS_KEY, type StorageArea } from "./storage.ts";

export { SETTINGS_KEY };

export type Motion = "system" | "reduce" | "full";

export interface Settings {
  readonly motion: Motion;
}

export const DEFAULT_SETTINGS: Settings = { motion: "system" };

const MOTIONS: readonly Motion[] = ["system", "reduce", "full"];

function isMotion(value: unknown): value is Motion {
  return MOTIONS.some((motion) => motion === value);
}

export function readSettings(storage: Pick<Storage, "getItem">): Settings {
  let stored: unknown;
  try {
    stored = JSON.parse(storage.getItem(SETTINGS_KEY) ?? "null");
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof stored !== "object" || stored === null) return DEFAULT_SETTINGS;
  const { motion } = stored as Record<string, unknown>;
  return { motion: isMotion(motion) ? motion : DEFAULT_SETTINGS.motion };
}

export function saveSettings(storage: StorageArea, settings: Settings): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function reducesMotion(motion: Motion, systemReduces: boolean): boolean {
  return motion === "reduce" || (motion === "system" && systemReduces);
}

/** Tells the app, which keeps motion for every window and the next start. */
export function reportMotion(motion: Motion): void {
  desktopBindings()?.setMotion?.(motion).catch((error) =>
    console.error("Could not save the motion setting:", error)
  );
}

export function chooseMotion(storage: StorageArea, motion: Motion): void {
  try {
    saveSettings(storage, { ...readSettings(storage), motion });
  } catch (error) {
    console.error("Could not save the setting:", error);
  }
}

export function enableSettings(
  onMotion: (motion: Motion) => void = () => {},
): () => void {
  const storage = browserStorage();
  const system = matchMedia("(prefers-reduced-motion: reduce)");
  const root = document.documentElement;
  const apply = (): void => {
    if (reducesMotion(readSettings(storage).motion, system.matches)) {
      root.dataset["motion"] = "reduce";
    } else {
      delete root.dataset["motion"];
    }
  };
  apply();
  system.addEventListener("change", apply);
  addEventListener("storage", (event) => {
    if (event.key === SETTINGS_KEY || event.key === null) apply();
  });
  reportMotion(readSettings(storage).motion);
  desktopBindings()?.onMotionChosen?.((motion) => {
    chooseMotion(storage, motion);
    apply();
    onMotion(motion);
  }).catch((error) =>
    console.error("Could not follow the motion setting:", error)
  );
  return apply;
}
