import { checkFontProfile } from "../lib/fonts.ts";
import {
  extractPlistXml,
  importProfileXml,
  type ProfileImport,
} from "../lib/import.ts";
import type { ConfigSource } from "../lib/types.ts";

export const DEPRECATED_FORMAT_NOTE =
  "Legacy DNS payload, deprecated by Apple but still working on iOS/macOS 27 and later. Use the Declaration format instead.";

async function sha256(
  content: string | Uint8Array<ArrayBuffer>,
): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle as SubtleCrypto | undefined;
  if (subtle === undefined) return undefined;
  const digest = await subtle.digest(
    "SHA-256",
    typeof content === "string" ? new TextEncoder().encode(content) : content,
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

export interface FontProfile {
  readonly file: string;
  readonly xml: string;
  readonly fonts: number;
  /** Of the file's bytes as dropped, as `shasum -a 256` gives it. */
  readonly sha256?: string;
}

/**
 * The dropped file as a font profile, undefined when it holds no fonts.
 * Throws when it holds fonts that Apple's rules don't allow.
 */
export async function readFontProfile(
  file: File,
): Promise<FontProfile | undefined> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let xml: string;
  try {
    xml = extractPlistXml(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
  const check = checkFontProfile(xml);
  if (check === undefined) return undefined;
  if (!check.valid) throw new Error(check.error);
  const hash = await sha256(bytes);
  return {
    file: file.name,
    xml,
    fonts: check.fonts,
    ...(hash === undefined ? {} : { sha256: hash }),
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
