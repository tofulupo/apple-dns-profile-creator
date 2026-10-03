import type { DesktopBindings } from "../desktop/bindings.ts";
import { desktopBindings } from "./desktop.ts";
import { dialogOpen } from "./dialogs.ts";

const MINOR_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
]);

export function menuTitle(label: string): string {
  return label.trim().split(/\s+/).map((word, index) =>
    index > 0 && MINOR_WORDS.has(word.toLowerCase())
      ? word.toLowerCase()
      : word.charAt(0).toUpperCase() + word.slice(1)
  ).join(" ");
}

export type SaveMenuBindings = Pick<
  DesktopBindings,
  "setSaveAction" | "onSaveRequested"
>;

export type UpdateSaveMenu = (label: string, enabled: boolean) => void;

export function enableSaveMenu(
  save: () => void,
  bindings: Partial<SaveMenuBindings> | undefined = desktopBindings(),
): UpdateSaveMenu {
  const setSaveAction = bindings?.setSaveAction;
  const listen = bindings?.onSaveRequested;
  if (typeof setSaveAction !== "function" || typeof listen !== "function") {
    return () => {};
  }
  listen(() => {
    if (!dialogOpen()) save();
  }).catch((error) => console.error("Could not listen for Save:", error));

  let shown: string | undefined;
  return (label, enabled) => {
    const title = menuTitle(label);
    const key = JSON.stringify([title, enabled]);
    if (key === shown) return;
    shown = key;
    setSaveAction(title, enabled).catch((error) =>
      console.error("Could not update File > Save:", error)
    );
  };
}

export type ShareMenuBindings = Pick<
  DesktopBindings,
  "setShareEnabled" | "onShareRequested"
>;

/** The app turns File > Share… off as each page loads (src-tauri/src/menu.rs). */
export function enableShareMenu(
  share: () => void,
  bindings: Partial<ShareMenuBindings> | undefined = desktopBindings(),
): (enabled: boolean) => void {
  const setShareEnabled = bindings?.setShareEnabled;
  const listen = bindings?.onShareRequested;
  if (typeof setShareEnabled !== "function" || typeof listen !== "function") {
    return () => {};
  }
  listen(() => {
    if (!dialogOpen()) share();
  }).catch((error) => console.error("Could not listen for Share:", error));

  let shown: boolean | undefined;
  return (enabled) => {
    if (enabled === shown) return;
    shown = enabled;
    setShareEnabled(enabled).catch((error) =>
      console.error("Could not update File > Share:", error)
    );
  };
}
