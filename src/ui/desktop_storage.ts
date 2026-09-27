/**
 * Keeps the page's stored data across desktop app launches.
 *
 * In the desktop app the pages store their data in `sessionStorage` (see
 * `storageArea()`), which lives only as long as the window. This module copies
 * the lasting keys to a file through the app's bindings, and restores them on
 * the first page of a launch. In a browser there are no bindings and it does
 * nothing.
 */

import { type StorageBindings, storageBindings } from "./desktop.ts";
import {
  isLastingKey,
  onStorageWrite,
  RESTORED_KEY,
  storageArea,
} from "./storage.ts";

/** The part of `Storage` needed to list, read and fill it. */
export type EnumerableStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;

/** The lasting entries in `storage`, session-only and foreign keys left out. */
export function snapshot(storage: EnumerableStorage): Record<string, string> {
  const data: Record<string, string> = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key === null || !isLastingKey(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) data[key] = value;
  }
  return data;
}

/**
 * On the first page of a launch, restores the file into `storage`. On later
 * pages, brings the file up to date instead, in case a save was cut short by
 * the page change. Returns a function that saves the current state, one save
 * at a time so they land in order.
 */
export async function syncStorage(
  storage: EnumerableStorage,
  bindings: StorageBindings,
): Promise<() => Promise<void>> {
  let queue = Promise.resolve();
  const save = (): Promise<void> => {
    // A failed save must not block the ones after it.
    const next = queue.catch(() => {}).then(() =>
      bindings.saveStorage(snapshot(storage))
    );
    queue = next;
    return next;
  };

  if (storage.getItem(RESTORED_KEY) === null) {
    const saved = await bindings.loadStorage();
    for (const [key, value] of Object.entries(saved)) {
      if (isLastingKey(key) && typeof value === "string") {
        storage.setItem(key, value);
      }
    }
    storage.setItem(RESTORED_KEY, "1");
  } else {
    await save();
  }
  return save;
}

/**
 * Called by each page before it reads storage. Never throws: without the file
 * the app still works, it just forgets on quit.
 */
export async function restoreDesktopStorage(): Promise<void> {
  const bindings = storageBindings();
  if (bindings === undefined) return;
  try {
    const save = await syncStorage(storageArea(), bindings);
    onStorageWrite(() => {
      save().catch((error) =>
        console.error("Could not keep the stored data:", error)
      );
    });
  } catch (error) {
    console.error("Could not restore the stored data:", error);
  }
}
