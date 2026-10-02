/**
 * Local file download, and sharing through the system share sheet.
 */
import type { DesktopBindings } from "../desktop/bindings.ts";
import { desktopBindings } from "./desktop.ts";

const MOBILECONFIG_MIME = "application/x-apple-aspen-config";

function desktopSave(): DesktopBindings["saveProfile"] | undefined {
  const bindings = desktopBindings();
  return typeof bindings?.saveProfile === "function"
    ? bindings.saveProfile
    : undefined;
}

/**
 * A failed desktop command rejects with the Rust side's message as a plain
 * string rather than an `Error`. Turned into one here, so callers can rely on
 * `.message`.
 */
export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Saves the profile. `signWith`, the id of a Keychain identity, is only
 * possible in the desktop app, which signs before saving.
 */
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

/** The profile as a file, the same for a download and a share. */
export function profileFile(filename: string, xml: string): File {
  return new File([xml], filename, { type: MOBILECONFIG_MIME });
}

/**
 * Whether the share sheet can take the profile file. Never in the desktop
 * app, where a signed profile only exists on the Rust side. Elsewhere it
 * needs a secure context (`navigator.share` is missing on a plain http:// LAN
 * address) and a browser that accepts the file type: browsers only share
 * the types they allow, and Chrome's list may well leave .mobileconfig out.
 */
export function canShareProfile(
  filename: string,
  nav: Navigator = navigator,
): boolean {
  if (desktopSave() !== undefined) return false;
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") {
    return false;
  }
  try {
    return nav.canShare({ files: [profileFile(filename, "")] });
  } catch {
    return false;
  }
}

/**
 * Opens the share sheet with the profile file alone: some targets drop a
 * file that comes with text. Resolves false when the user closed the sheet
 * without sharing, which is not an error. Must be called straight from the
 * click, with nothing awaited before it, or the browser refuses it.
 */
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
