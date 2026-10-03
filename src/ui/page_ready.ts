import { desktopBindings } from "./desktop.ts";

type Rgb = [red: number, green: number, blue: number];

/** Matches `rgb(14, 16, 19)`, or `rgba(…)` with any alpha. */
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
  new MutationObserver(signal).observe(document.documentElement, {
    attributeFilter: ["data-theme"],
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener(
    "change",
    signal,
  );
  if (document.hidden) {
    signal();
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(signal));
}
