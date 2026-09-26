/**
 * Local file download.
 */
import type { DesktopBindings } from "../desktop/bindings.ts";

const MOBILECONFIG_MIME = "application/x-apple-aspen-config";

type SaveProfile = DesktopBindings["saveProfile"];

/**
 * `deno desktop` exposes Deno-side handlers on a `bindings` global.
 */
function desktopSave(): SaveProfile | undefined {
  const host = globalThis as { bindings?: Partial<DesktopBindings> };
  return typeof host.bindings?.saveProfile === "function"
    ? host.bindings.saveProfile
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

export async function downloadProfile(
  filename: string,
  xml: string,
): Promise<void> {
  const save = desktopSave();
  if (save !== undefined) {
    try {
      await save(filename, xml);
    } catch (error) {
      throw asError(error);
    }
    return;
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
