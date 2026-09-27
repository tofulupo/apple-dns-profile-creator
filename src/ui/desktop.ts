/**
 * The desktop app's bindings, as the pages see them.
 */
import type { DesktopBindings } from "../desktop/bindings.ts";

/**
 * The desktop app's bindings, or undefined in a browser. `deno desktop`
 * exposes Deno-side handlers on a `bindings` global.
 */
export function desktopBindings(): Partial<DesktopBindings> | undefined {
  return (globalThis as { bindings?: Partial<DesktopBindings> }).bindings;
}

export type StorageBindings = Pick<
  DesktopBindings,
  "loadStorage" | "saveStorage"
>;

/**
 * The bindings that keep the stored data in a file, or undefined in a
 * browser. The one test for where the pages keep their data: `storageArea()`
 * picks `sessionStorage` exactly when these exist, so nothing ends up there
 * without also being saved.
 */
export function storageBindings(): StorageBindings | undefined {
  const { loadStorage, saveStorage } = desktopBindings() ?? {};
  return typeof loadStorage === "function" &&
      typeof saveStorage === "function"
    ? { loadStorage, saveStorage }
    : undefined;
}
