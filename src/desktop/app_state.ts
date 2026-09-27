/**
 * What the desktop app remembers between launches, in its Application
 * Support folder: the window's size, and the page's stored data.
 *
 * Two files rather than one, so a corrupt data file can never affect how the
 * window opens. Loading never throws: a missing, unreadable or corrupt file
 * must not stop the app from starting.
 */

import { dirname, join, parse } from "@std/path";

/**
 * Writes via a temporary file, so a crash never leaves half a file behind.
 * The temporary name is unique, so overlapping saves cannot collide.
 */
async function writeAtomically(path: string, text: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(temporary, text);
  await Deno.rename(temporary, path);
}

/**
 * Deletes temporary files in `folder` left by a save that was cut short, by a
 * crash for example. Never throws.
 */
export async function removeLeftoverTemporaryFiles(
  folder: string,
): Promise<void> {
  try {
    for await (const entry of Deno.readDir(folder)) {
      if (entry.isFile && entry.name.endsWith(".tmp")) {
        await Deno.remove(join(folder, entry.name)).catch(() => {});
      }
    }
  } catch {
    // No folder yet: nothing to clean.
  }
}

/**
 * Deletes the per-origin folders in WebKit's website data folder `folder`
 * (`~/Library/WebKit/<bundle id>/WebsiteData/Default`). Earlier versions kept
 * their data in localStorage, which WebKit stores per origin, and the app's
 * origin changes every launch, so each launch left a database behind that
 * nothing reads. Only folders are removed; WebKit's own files beside them
 * stay.
 *
 * Runs once, then creates `marker`: this version leaves no such folders, and
 * WebKit is starting up in the same folder while this runs. Never throws.
 */
export async function removeOldWebsiteData(
  folder: string,
  marker: string,
): Promise<void> {
  try {
    await Deno.stat(marker);
    return;
  } catch {
    // Not cleaned yet.
  }
  try {
    for await (const entry of Deno.readDir(folder)) {
      if (entry.isDirectory) {
        await Deno.remove(join(folder, entry.name), { recursive: true })
          .catch(() => {});
      }
    }
  } catch {
    // No folder: nothing was ever stored.
  }
  // Written directly: an empty file needs no atomic write, and a temporary
  // file could be caught by removeLeftoverTemporaryFiles running meanwhile.
  try {
    await Deno.mkdir(dirname(marker), { recursive: true });
    await Deno.writeTextFile(marker, "");
  } catch {
    // Cleaned again on the next launch, which is harmless.
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Window size
//
// Size only, not position: a saved position can point at a display that is no
// longer connected, nothing here can tell, and the window would then open out
// of sight.

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

/** The size saved at `path`, or the default. */
export async function loadWindowSize(path: string): Promise<WindowSize> {
  return parseWindowSize(await readJson(path)) ?? DEFAULT_WINDOW_SIZE;
}

/** Saves `size` to `path`, creating its folder. Out-of-range sizes are skipped. */
export async function saveWindowSize(
  path: string,
  size: WindowSize,
): Promise<void> {
  const valid = parseWindowSize(size);
  if (valid === undefined) return;
  await writeAtomically(path, `${JSON.stringify(valid)}\n`);
}

// ---------------------------------------------------------------------------
// Stored data
//
// `deno desktop` serves the app from a new 127.0.0.1 port on every launch, so
// the webview's own storage, which belongs to the origin, would start empty
// each time. The page keeps its data in memory and mirrors the lasting keys
// into this file instead (see src/ui/desktop_storage.ts).

/** Key/value pairs, as in localStorage. */
export type StoredData = Record<string, string>;

/** Must match `KEY_PREFIX` in src/ui/storage.ts; a test checks both. */
export const STORED_KEY_PREFIX = "dns-mobileconfig:";

/** Far above what any real list of configurations needs. */
export const MAX_STORED_BYTES = 5 * 1024 * 1024;

/**
 * The app's own string entries from `value`, anything else dropped. Undefined
 * when `value` is not an object or is implausibly large.
 */
export function parseStoredData(value: unknown): StoredData | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const data: StoredData = {};
  let bytes = 0;
  for (const [key, entry] of Object.entries(value)) {
    if (!key.startsWith(STORED_KEY_PREFIX) || typeof entry !== "string") {
      continue;
    }
    bytes += key.length + entry.length;
    if (bytes > MAX_STORED_BYTES) return undefined;
    data[key] = entry;
  }
  return data;
}

/**
 * Moves a data file that could not be loaded out of the way, to
 * `<name>.corrupt-<time>.json` beside it: the next save would otherwise
 * replace it, and with it the only copy of the list. Never throws.
 */
async function setAside(path: string): Promise<void> {
  const { dir, name, ext } = parse(path);
  const time = new Date().toISOString().replaceAll(":", "-");
  await Deno.rename(path, join(dir, `${name}.corrupt-${time}${ext}`))
    .catch(() => {});
}

/**
 * The data saved at `path`, or none. A file that exists but cannot be loaded
 * is set aside rather than left for the next save to replace.
 */
export async function loadStoredData(path: string): Promise<StoredData> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) await setAside(path);
    return {};
  }
  let data: StoredData | undefined;
  try {
    data = parseStoredData(JSON.parse(text));
  } catch {
    data = undefined;
  }
  if (data === undefined) await setAside(path);
  return data ?? {};
}

/**
 * A save function for `path` that applies saves one at a time, in the order
 * they arrive. A save from the page being left can still be running when the
 * next page saves, and must not land after it. A failed save does not block
 * the ones after it.
 */
export function createStoredDataSaver(
  path: string,
): (data: unknown) => Promise<void> {
  let queue = Promise.resolve();
  return (data) => {
    const next = queue.catch(() => {}).then(() => saveStoredData(path, data));
    queue = next;
    return next;
  };
}

/** Replaces the data saved at `path`. Refuses data it would not load. */
export async function saveStoredData(
  path: string,
  data: unknown,
): Promise<void> {
  const valid = parseStoredData(data);
  if (valid === undefined) {
    throw new TypeError("Stored data must be an object of text entries.");
  }
  await writeAtomically(path, `${JSON.stringify(valid)}\n`);
}
