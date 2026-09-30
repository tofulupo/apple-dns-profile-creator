/**
 * Profiles opened with the desktop app (Finder's Open With, the Dock icon,
 * File > Open Profile…), handed to the page's own import as if each had been
 * dropped on it. Does nothing in a browser.
 */

import type { DesktopBindings } from "../desktop/bindings.ts";
import { desktopBindings } from "./desktop.ts";

const MOBILECONFIG_MIME = "application/x-apple-aspen-config";

/**
 * Imports one profile. Resolves with false when the import leaves the page,
 * so the rest stay queued for the next page instead of being lost with this
 * one.
 */
export type ImportProfile = (file: File) => Promise<boolean | void>;

export type OpenedBindings = Pick<
  DesktopBindings,
  "takeOpenedProfile" | "onProfilesOpened"
>;

/**
 * Takes queued profiles one at a time and imports each, now for any that
 * launched the app or arrived during a page change, and again whenever more
 * are opened. Returns once listening.
 */
export async function receiveOpenedProfiles(
  importProfile: ImportProfile,
  bindings: Partial<OpenedBindings> | undefined = desktopBindings(),
): Promise<void> {
  const takeBinding = bindings?.takeOpenedProfile;
  const listen = bindings?.onProfilesOpened;
  if (typeof takeBinding !== "function" || typeof listen !== "function") {
    return;
  }
  const take: OpenedBindings["takeOpenedProfile"] = takeBinding;

  let running = false;
  let again = false;
  let leaving = false;

  async function drain(): Promise<void> {
    if (leaving) return;
    // One pass at a time; a notice during a pass makes it look once more.
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        for (let next = await take(); next !== null; next = await take()) {
          const file = new File([next.text], next.name, {
            type: MOBILECONFIG_MIME,
          });
          if (await importProfile(file) === false) {
            leaving = true;
            return;
          }
        }
      } while (again && !leaving);
    } catch (error) {
      console.error("Could not import an opened profile:", error);
    } finally {
      running = false;
    }
  }

  await listen(() => void drain());
  await drain();
}
