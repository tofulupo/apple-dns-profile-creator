/**
 * Local file download.
 */
const MOBILECONFIG_MIME = "application/x-apple-aspen-config";

type SaveProfile = (filename: string, xml: string) => Promise<void>;

/**
 * `deno desktop` exposes Deno-side handlers on a `bindings` global.
 */
function desktopSave(): SaveProfile | undefined {
  const host = globalThis as { bindings?: { saveProfile?: SaveProfile } };
  return typeof host.bindings?.saveProfile === "function"
    ? host.bindings.saveProfile
    : undefined;
}

export async function downloadProfile(
  filename: string,
  xml: string,
): Promise<void> {
  const save = desktopSave();
  if (save !== undefined) {
    await save(filename, xml);
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
