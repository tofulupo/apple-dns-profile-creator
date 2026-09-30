/**
 * File > Save (⌘S) in the desktop app, which does what the page's main button
 * does: Add to Profile or Save Changes on the tool page, Download on the
 * profile page. Does nothing in a browser.
 */

import type { DesktopBindings } from "../desktop/bindings.ts";
import { desktopBindings } from "./desktop.ts";
import { dialogOpen } from "./dialogs.ts";

/** Words macOS menus leave in lower case inside a title. */
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

/**
 * A button's sentence-case label in the title case of a Mac menu item:
 * "Add to profile" becomes "Add to Profile".
 */
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

/** Updates File > Save: named after the button's label, and whether usable. */
export type UpdateSaveMenu = (label: string, enabled: boolean) => void;

/**
 * Makes ⌘S call `save`, except while a dialog is open. Returns the function
 * that keeps the menu item in step with the page's button.
 */
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
    // Pages update on every render; the menu only needs to hear of changes.
    const key = JSON.stringify([title, enabled]);
    if (key === shown) return;
    shown = key;
    setSaveAction(title, enabled).catch((error) =>
      console.error("Could not update File > Save:", error)
    );
  };
}
