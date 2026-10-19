// Söhne and Berkeley Mono are licensed for the website only: they may be
// served, not published in the repository.
import { join } from "@std/path";

import { SOEHNE_FACES } from "./fonts.ts";

export const BERKELEY_MONO = "Berkeley_Mono.woff2";

export const WEB_FONTS: readonly string[] = [
  ...Object.values(SOEHNE_FACES),
  BERKELEY_MONO,
];

/** A folder with WEB_FONTS, relative to the repo; read by `deno task build`. */
export const WEB_FONTS_DIR = "WEB_FONTS_DIR";

/** Copies every one of `names` from `from`, or none: a partial set is an error. */
export async function copyWebFonts(
  from: string,
  names: readonly string[],
  to: string,
): Promise<string[]> {
  const fonts: [string, Uint8Array][] = [];
  for (const name of names) {
    let bytes: Uint8Array;
    try {
      bytes = await Deno.readFile(join(from, name));
    } catch {
      throw new Error(`${WEB_FONTS_DIR}: ${name} is missing in ${from}`);
    }
    if (!isWoff2(bytes)) {
      throw new Error(`${WEB_FONTS_DIR}: ${name} is not a WOFF2 file`);
    }
    fonts.push([name, bytes]);
  }
  await Deno.mkdir(to, { recursive: true });
  for (const [name, bytes] of fonts) {
    await Deno.writeFile(join(to, name), bytes);
  }
  return [...names].sort();
}

export function isWoff2(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, 4)) === "wOF2";
}
