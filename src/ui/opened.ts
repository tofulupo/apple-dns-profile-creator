import type { DesktopBindings } from "../desktop/bindings.ts";
import { desktopBindings } from "./desktop.ts";

const MOBILECONFIG_MIME = "application/x-apple-aspen-config";

export type ImportProfile = (file: File) => Promise<boolean | void>;

export type OpenedBindings = Pick<
  DesktopBindings,
  "takeOpenedProfile" | "onProfilesOpened"
>;

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
