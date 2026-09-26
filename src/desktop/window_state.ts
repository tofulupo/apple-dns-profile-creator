/**
 * Remembers the desktop window's size between launches.
 *
 * Size only, not position: a saved position can point at a display that is no
 * longer connected, nothing here can tell, and the window would then open out
 * of sight.
 */

import { dirname } from "@std/path";

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

export const DEFAULT_WINDOW_SIZE: WindowSize = { width: 900, height: 840 };

/** Keeps a corrupt or hand-edited file from opening a sliver or a giant. */
const MIN_DIMENSION = 240;
const MAX_DIMENSION = 10_000;

function isDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= MIN_DIMENSION && value <= MAX_DIMENSION;
}

export function parseWindowSize(value: unknown): WindowSize | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { width, height } = value as Record<string, unknown>;
  return isDimension(width) && isDimension(height)
    ? { width: Math.round(width), height: Math.round(height) }
    : undefined;
}

/**
 * The size saved at `path`, or the default. Never throws: a missing,
 * unreadable or corrupt file must not stop the app from starting.
 */
export async function loadWindowSize(path: string): Promise<WindowSize> {
  try {
    const saved = parseWindowSize(JSON.parse(await Deno.readTextFile(path)));
    return saved ?? DEFAULT_WINDOW_SIZE;
  } catch {
    return DEFAULT_WINDOW_SIZE;
  }
}

/** Saves `size` to `path`, creating its folder. Out-of-range sizes are skipped. */
export async function saveWindowSize(
  path: string,
  size: WindowSize,
): Promise<void> {
  const valid = parseWindowSize(size);
  if (valid === undefined) return;
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, `${JSON.stringify(valid)}\n`);
}
