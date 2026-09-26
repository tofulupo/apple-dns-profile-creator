/**
 * Saving profiles for the desktop app: into a folder, never over a file that
 * is already there.
 */

import { join } from "@std/path";

const EXTENSION = ".mobileconfig";
const FALLBACK_STEM = "profile";
/** Far more than anyone needs; stops a runaway loop in a pathological folder. */
const MAX_ATTEMPTS = 1000;

/**
 * A plain file name ending in `.mobileconfig`, which is what makes macOS hand
 * the file to System Settings. The name comes from the webview, so any folder
 * part is dropped rather than trusted, along with control characters and the
 * colon, which macOS file names cannot hold.
 */
export function profileFilename(requested: string): string {
  const base = requested.split(/[/\\]/).at(-1) ?? "";
  const stem = base
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001F\u007F:]/g, "")
    .trim()
    .replace(/\.mobileconfig$/i, "")
    .trim()
    // A leading dot would hide the file in Finder.
    .replace(/^\.+/, "");
  return `${stem === "" ? FALLBACK_STEM : stem}${EXTENSION}`;
}

/**
 * The `n`th name to try for `filename`, numbered the way Finder numbers
 * copies: `a.mobileconfig`, `a 2.mobileconfig`, `a 3.mobileconfig`...
 * `filename` must come from `profileFilename`.
 */
export function numberedFilename(filename: string, n: number): string {
  if (n <= 1) return filename;
  return `${filename.slice(0, -EXTENSION.length)} ${n}${EXTENSION}`;
}

/**
 * Writes `contents` into `folder` under a name derived from `requested`,
 * creating the folder if needed. Returns the path written. Text is written as
 * UTF-8; bytes, such as a signed profile, as they are.
 */
export async function saveWithoutOverwrite(
  folder: string,
  requested: string,
  contents: string | Uint8Array,
): Promise<string> {
  await Deno.mkdir(folder, { recursive: true });
  const filename = profileFilename(requested);
  const bytes = typeof contents === "string"
    ? new TextEncoder().encode(contents)
    : contents;

  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    const path = join(folder, numberedFilename(filename, n));
    try {
      // `createNew` makes the existence check and the write one step, so a
      // file that appears in between is still never replaced.
      await Deno.writeFile(path, bytes, { createNew: true });
      return path;
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
  }

  throw new Error(`No free file name left for ${filename} in ${folder}.`);
}
