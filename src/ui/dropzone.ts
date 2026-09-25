/**
 * Drag and drop onto a zone, and reading the profile that was dropped.
 *
 * Clicking, tapping and keyboard use are native: the tool page's zone is a
 * `<label>` around the file input, the profile page's a link. Only dropping
 * needs handling here.
 */

import { parseProfileXml } from "../lib/import.ts";
import type { DnsConfig } from "../lib/types.ts";

/**
 * Reads a chosen or dropped file as a configuration profile. Rejects when it
 * holds no DNS settings; turn the rejection into text with `uploadError`.
 */
export async function readProfileFile(file: File): Promise<DnsConfig[]> {
  const configs = parseProfileXml(await file.text());
  if (configs.length === 0) {
    throw new Error("That profile contains no DNS settings.");
  }
  return configs;
}

export function uploadError(error: unknown): string {
  return error instanceof Error ? error.message : "Could not read that file.";
}

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") === true;
}

export function enableDrop(
  zone: HTMLElement,
  onFile: (file: File) => void,
): void {
  // dragenter and dragleave fire for every child the pointer crosses, so count
  // them rather than clearing the highlight on the first dragleave.
  let depth = 0;

  const reset = (): void => {
    depth = 0;
    zone.classList.remove("zone--over");
  };

  zone.addEventListener("dragenter", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth += 1;
    zone.classList.add("zone--over");
  });

  zone.addEventListener("dragover", (event) => {
    if (!carriesFiles(event) || event.dataTransfer === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  zone.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) reset();
  });

  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    reset();
    const file = event.dataTransfer?.files[0];
    if (file !== undefined) onFile(file);
  });

  // A file dropped beside the zone would make the browser, or the desktop
  // webview, navigate to it and throw away whatever is in the form.
  document.addEventListener("dragover", (event) => {
    if (!carriesFiles(event) || event.dataTransfer === null) return;
    if (zone.contains(event.target as Node)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "none";
  });
  document.addEventListener("drop", (event) => {
    if (!zone.contains(event.target as Node)) event.preventDefault();
  });
}
