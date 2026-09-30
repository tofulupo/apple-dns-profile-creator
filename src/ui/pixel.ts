/**
 * The desktop app's pixel font: ⌘G six times in a row sets everything in
 * Geist Pixel, for an 80s terminal look, and six more switch it back. The app
 * has no Find, so ⌘G (Find Next) is free.
 *
 * It lasts until the app quits: `sessionStorage` carries it from Tool to
 * Profile, and the inline script in pages/_layout.html applies it before
 * first paint. css/app.css does the rest, through `data-pixel`.
 */

import { PIXEL_KEY } from "./storage.ts";

export { PIXEL_KEY };

const PRESSES = 6;
/** The longest pause between two presses that still counts as in a row. */
const MAX_GAP_MS = 1000;

/**
 * Counts presses by their time in milliseconds. True on the one that
 * completes `presses` in a row, each within `maxGap` of the one before;
 * counting then starts over.
 */
export function pressCounter(
  presses = PRESSES,
  maxGap = MAX_GAP_MS,
): (time: number) => boolean {
  let count = 0;
  let last = -Infinity;
  return (time) => {
    count = time - last <= maxGap ? count + 1 : 1;
    last = time;
    if (count < presses) return false;
    count = 0;
    return true;
  };
}

function isCommandG(event: KeyboardEvent): boolean {
  return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey &&
    event.key.toLowerCase() === "g";
}

export function enablePixelMode(): void {
  const root = document.documentElement;
  if (root.dataset["app"] !== "desktop") return;
  const pressed = pressCounter();
  // Captured, so a focused field or the page's own handlers cannot keep it.
  addEventListener("keydown", (event) => {
    if (!isCommandG(event)) return;
    // No menu item takes ⌘G, and unhandled macOS would beep.
    event.preventDefault();
    // Holding the keys down is not pressing them six times.
    if (event.repeat || !pressed(event.timeStamp)) return;
    const on = root.toggleAttribute("data-pixel");
    try {
      if (on) sessionStorage.setItem(PIXEL_KEY, "on");
      else sessionStorage.removeItem(PIXEL_KEY);
    } catch {
      // Then it only lasts for this page.
    }
  }, { capture: true });
}
