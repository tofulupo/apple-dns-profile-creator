/**
 * Local file download.
 */
import type { DesktopBindings } from "../desktop/bindings.ts";

const MOBILECONFIG_MIME = "application/x-apple-aspen-config";

/**
 * The desktop app's bindings, or undefined in a browser. `deno desktop`
 * exposes Deno-side handlers on a `bindings` global.
 */
export function desktopBindings(): Partial<DesktopBindings> | undefined {
  return (globalThis as { bindings?: Partial<DesktopBindings> }).bindings;
}

function desktopSave(): DesktopBindings["saveProfile"] | undefined {
  const bindings = desktopBindings();
  return typeof bindings?.saveProfile === "function"
    ? bindings.saveProfile
    : undefined;
}

/**
 * A binding's rejection arrives as a plain `{ name, message, stack }` object,
 * which would print as "[object Object]". Turned back into an `Error` here.
 */
export function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (
    typeof error === "object" && error !== null && "message" in error &&
    typeof error.message === "string"
  ) {
    return new Error(error.message);
  }
  return new Error(String(error));
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
