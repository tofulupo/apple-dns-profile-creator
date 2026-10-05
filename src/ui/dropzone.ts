import { importProfileXml, type ProfileImport } from "../lib/import.ts";
import type { ConfigSource } from "../lib/types.ts";

export const DEPRECATED_FORMAT_NOTE =
  "Legacy DNS payload, deprecated by Apple but still working on iOS/macOS 27 and later. Use the Declaration format instead.";

async function sha256(text: string): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle as SubtleCrypto | undefined;
  if (subtle === undefined) return undefined;
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function readProfileFile(file: File): Promise<ProfileImport> {
  const text = await file.text();
  const result = importProfileXml(text);
  if (result.configs.length === 0) {
    throw new Error("That profile contains no DNS settings.");
  }
  const hash = await sha256(text);
  const source: ConfigSource = {
    file: file.name,
    ...(result.profileId === undefined ? {} : { profileId: result.profileId }),
    ...(hash === undefined ? {} : { sha256: hash }),
    ...(result.systemScope === undefined
      ? {}
      : { systemScope: result.systemScope }),
  };
  return {
    ...result,
    configs: result.configs.map((config) => ({ ...config, source })),
    warnings: result.usesDeprecatedPayload
      ? [DEPRECATED_FORMAT_NOTE, ...result.warnings]
      : result.warnings,
  };
}

export function uploadError(error: unknown): string {
  return error instanceof Error ? error.message : "Could not read that file.";
}

function isInside(zone: HTMLElement, event: Event): boolean {
  return event.target instanceof Node && zone.contains(event.target);
}

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") === true;
}

export function enableDrop(
  zone: HTMLElement,
  onFile: (file: File) => void,
): void {
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

  document.addEventListener("dragover", (event) => {
    if (!carriesFiles(event) || event.dataTransfer === null) return;
    if (isInside(zone, event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "none";
  });
  document.addEventListener("drop", (event) => {
    if (!isInside(zone, event)) event.preventDefault();
  });
}
