import type { Anchor, DesktopBindings } from "../desktop/bindings.ts";
import { desktopBindings } from "./desktop.ts";

const MOBILECONFIG_MIME = "application/x-apple-aspen-config";

function desktopSave(): DesktopBindings["saveProfile"] | undefined {
  const bindings = desktopBindings();
  return typeof bindings?.saveProfile === "function"
    ? bindings.saveProfile
    : undefined;
}

function desktopShare(): DesktopBindings["shareProfile"] | undefined {
  const bindings = desktopBindings();
  return typeof bindings?.shareProfile === "function"
    ? bindings.shareProfile
    : undefined;
}

export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function downloadProfile(
  filename: string,
  xml: string,
  signWith?: string,
): Promise<void> {
  const save = desktopSave();
  if (save !== undefined) {
    try {
      await save(filename, xml, signWith);
    } catch (error) {
      throw asError(error);
    }
    return;
  }

  if (signWith !== undefined) {
    throw new Error("Signing is only available in the desktop app.");
  }

  const url = URL.createObjectURL(profileFile(filename, xml));

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();

  // Give the browser a moment to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function profileFile(filename: string, xml: string): File {
  return new File([xml], filename, { type: MOBILECONFIG_MIME });
}

export function canShareProfile(
  filename: string,
  nav: Navigator = navigator,
): boolean {
  if (desktopSave() !== undefined) return desktopShare() !== undefined;
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") {
    return false;
  }
  try {
    return nav.canShare({ files: [profileFile(filename, "")] });
  } catch {
    return false;
  }
}

export async function shareProfileInApp(
  filename: string,
  xml: string,
  signWith: string | undefined,
  anchor: Anchor,
): Promise<void> {
  const share = desktopShare();
  if (share === undefined) {
    throw new Error("Sharing from the app needs the desktop app.");
  }
  try {
    await share(filename, xml, signWith, anchor);
  } catch (error) {
    throw asError(error);
  }
}

export async function shareProfile(
  filename: string,
  xml: string,
  nav: Navigator = navigator,
): Promise<boolean> {
  try {
    await nav.share({ files: [profileFile(filename, xml)] });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return false;
    }
    throw asError(error);
  }
}
