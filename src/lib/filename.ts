import { distinctSettings } from "./settings.ts";
import type { DnsConfig } from "./types.ts";

export const NEUTRAL_STEM = "encrypted-dns";
const EXTENSION = ".mobileconfig";
/** Keeps a long provider name from filling Finder's name column. */
const MAX_STEM = 40;

export interface FilenameOptions {
  readonly signed: boolean;
  readonly neutral: boolean;
}

export function safeStem(name: string): string {
  const stem = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (stem.length <= MAX_STEM) return stem;
  const cut = stem.slice(0, MAX_STEM);
  const hyphen = cut.lastIndexOf("-");
  return (hyphen > 0 ? cut.slice(0, hyphen) : cut).replace(/-+$/, "");
}

/** A loaded file's name with `-signed` before `.mobileconfig`, once. */
export function signedFilename(file: string): string {
  const stem = file.replace(/\.mobileconfig$/i, "").trim();
  const unsigned = stem.replace(/-signed$/i, "");
  return `${unsigned === "" ? NEUTRAL_STEM : unsigned}-signed${EXTENSION}`;
}

export function profileFilename(
  configs: readonly DnsConfig[],
  options: FilenameOptions,
): string {
  const distinct = distinctSettings(configs);
  const [only] = distinct;
  const named = !options.neutral && distinct.length === 1 && only !== undefined
    ? safeStem(only.name)
    : "";
  const stem = named === "" ? NEUTRAL_STEM : named;
  return `${stem}${options.signed ? "-signed" : ""}${EXTENSION}`;
}
