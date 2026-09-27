/**
 * Tells the desktop app that the page has painted, so it can show its window,
 * which it keeps hidden until then. Does nothing in a browser.
 */

import { desktopBindings } from "./desktop.ts";

export function signalPageReady(): void {
  const pageReady = desktopBindings()?.pageReady;
  if (typeof pageReady !== "function") return;
  // The first frame is scheduled after this callback, and painted by the
  // time the second one runs.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      pageReady().catch((error) =>
        console.error("Could not show the window:", error)
      );
    })
  );
}
