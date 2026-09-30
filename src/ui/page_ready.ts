/**
 * Tells the desktop app that the page is ready to paint, so it can show its
 * window, which it keeps hidden until then. Does nothing in a browser.
 */

import { desktopBindings } from "./desktop.ts";

type Rgb = [red: number, green: number, blue: number];

/**
 * A computed CSS colour (`rgb(14, 16, 19)`, or `rgba(…)` with any alpha) as
 * red, green and blue, or undefined for any other form.
 */
export function parseRgb(color: string): Rgb | undefined {
  const match = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color);
  if (match === null) return undefined;
  const channels = match.slice(1, 4).map(Number);
  return channels.every((channel) => channel <= 255)
    ? channels as Rgb
    : undefined;
}

export function signalPageReady(): void {
  const pageReady = desktopBindings()?.pageReady;
  if (typeof pageReady !== "function") return;
  const signal = (): void => {
    const background = parseRgb(
      getComputedStyle(document.body).backgroundColor,
    );
    pageReady(background).catch((error) =>
      console.error("Could not show the window:", error)
    );
  };
  // The webview keeps the colour it was given, which also shows when
  // scrolling past the page's ends, so it follows the theme switch
  // (`data-theme`) and the system's appearance.
  new MutationObserver(signal).observe(document.documentElement, {
    attributeFilter: ["data-theme"],
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener(
    "change",
    signal,
  );
  // A hidden window's page paints nothing and runs no animation frames, so
  // waiting for one would wait for the app's fallback timer instead. Its
  // styles already apply here, and it paints as soon as it is shown.
  if (document.hidden) {
    signal();
    return;
  }
  // The first frame is scheduled after this callback, and painted by the
  // time the second one runs.
  requestAnimationFrame(() => requestAnimationFrame(signal));
}
