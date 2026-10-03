/**
 * The inline script in pages/_layout.html applies it before first paint.
 * css/app.css does the rest, through `data-pixel`.
 */

import { PIXEL_KEY } from "./storage.ts";

export { PIXEL_KEY };

const PRESSES = 6;
/** The longest pause between two presses that still counts as in a row. */
const MAX_GAP_MS = 1000;

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
  addEventListener("keydown", (event) => {
    if (!isCommandG(event)) return;
    event.preventDefault();
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
