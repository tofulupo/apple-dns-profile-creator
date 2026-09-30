/**
 * Local file download.
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

  const blob = new Blob([xml], { type: MOBILECONFIG_MIME });
  const url = URL.createObjectURL(blob);

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
