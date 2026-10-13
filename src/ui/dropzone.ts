import { checkFontProfile } from "../lib/fonts.ts";
import {
  extractPlistXml,
  importProfileXml,
  type ProfileImport,
  ProfileImportError,
} from "../lib/import.ts";
import { PlistParseError } from "../lib/plist.ts";
import { XmlParseError } from "../lib/xml.ts";
import type { ConfigSource, DnsConfig } from "../lib/types.ts";
import type { DesktopBindings } from "../desktop/bindings.ts";
import { desktopBindings } from "./desktop.ts";
import { asError } from "./download.ts";
import { type FileFacts, onMullvad, type Signature } from "./notes.ts";

/**
 * Far above any real profile, which is a few kilobytes. Must match
 * MAX_PROFILE_BYTES in src-tauri/src/opened.rs; a test checks both.
 */
export const MAX_PROFILE_BYTES = 5 * 1024 * 1024;

export const TOO_LARGE =
  "This file is too large to be a configuration profile. Try another .mobileconfig file.";

/** Refuses a file over the limit before anything reads it. */
function checkSize(file: File): void {
  if (file.size > MAX_PROFILE_BYTES) throw new Error(TOO_LARGE);
}

export const NOT_A_PROFILE =
  "This isn't a configuration profile. Try a .mobileconfig file.";

export const DAMAGED =
  "This file is damaged or isn't a configuration profile. Try another .mobileconfig file.";

export const NO_DNS_SETTINGS =
  "This profile has no DNS settings. Try a profile with encrypted DNS.";

export const UNREADABLE = "Couldn't read this file. Try loading it again.";

/** The tag a DER signed message starts with. A plain profile starts with `<`. */
const SEQUENCE = 0x30;
const LESS_THAN = 0x3c;
const WHITESPACE = [0x20, 0x09, 0x0a, 0x0d];

export type FileKind = "plain" | "signed" | "neither";

/**
 * What a file holds, by its first byte after an optional UTF-8 BOM and
 * whitespace. Anything in front of a signed message breaks its signature, so
 * it still counts as signed and goes to the signature check. Must match
 * `kind` in src-tauri/src/opened.rs; the tests use the same cases.
 */
export function fileKind(bytes: Uint8Array): FileKind {
  let at = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (at < bytes.length && WHITESPACE.includes(bytes[at]!)) at++;
  if (bytes[at] === LESS_THAN) return "plain";
  if (bytes[at] === SEQUENCE) return "signed";
  return "neither";
}

export type OpenDropped = DesktopBindings["openDroppedProfile"];

function desktopOpenDropped(): OpenDropped | undefined {
  const bindings = desktopBindings();
  return typeof bindings?.openDroppedProfile === "function"
    ? bindings.openDroppedProfile
    : undefined;
}

export interface Unwrapped {
  readonly file: File;
  readonly signature: Signature;
}

/**
 * A dropped or picked file, ready to read. In the app a signed one goes
 * through the signature check an opened one gets, and comes back as the
 * profile inside it. Undefined when the user doesn't open it after all.
 */
export async function unwrapDropped(
  file: File,
  open: OpenDropped | undefined = desktopOpenDropped(),
): Promise<Unwrapped | undefined> {
  checkSize(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = fileKind(bytes);
  if (kind === "neither") throw new Error(NOT_A_PROFILE);
  if (kind === "plain") return { file, signature: "none" };
  if (open === undefined) return { file, signature: "unchecked" };
  let text: string | null;
  try {
    text = await open(file.name, bytes);
  } catch (error) {
    throw asError(error);
  }
  return text === null ? undefined : {
    file: new File([text], file.name, { type: file.type }),
    signature: "unknown",
  };
}

export async function sha256(
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
  checkSize(file);
  const text = await file.text();
  const result = importProfileXml(text);
  if (result.configs.length === 0) {
    throw new Error(NO_DNS_SETTINGS);
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
  };
}

export interface LoadedProfile {
  readonly configs: DnsConfig[];
  readonly facts: FileFacts;
}

/**
 * A dropped or picked file, or one the app opened, which reaches the page
 * with its signature already checked. Undefined when the user doesn't open
 * it after all.
 */
export async function loadProfileFile(
  file: File,
  dropped: boolean,
  open: OpenDropped | undefined = desktopOpenDropped(),
): Promise<LoadedProfile | undefined> {
  const unwrapped: Unwrapped | undefined = dropped
    ? await unwrapDropped(file, open)
    : { file, signature: "unknown" };
  if (unwrapped === undefined) return undefined;
  const read = await readProfileFile(unwrapped.file);
  return {
    configs: read.configs,
    facts: {
      file: file.name,
      configs: read.configs.length,
      signature: unwrapped.signature,
      legacy: read.usesDeprecatedPayload,
      dot: read.configs.filter((config) => config.protocol === "TLS").length,
      mullvad: read.configs.some((config) => onMullvad(config.serverUrl)),
      leftOut: read.warnings,
    },
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
  checkSize(file);
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
  if (
    error instanceof XmlParseError || error instanceof PlistParseError ||
    error instanceof ProfileImportError
  ) return DAMAGED;
  return error instanceof Error ? error.message : UNREADABLE;
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
