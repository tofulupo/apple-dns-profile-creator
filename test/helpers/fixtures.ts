import { join, resolve } from "@std/path";

const here = import.meta.dirname;
if (here === undefined) {
  throw new Error("Fixture helper must be loaded from a file URL");
}

export const FIXTURE_ROOT = resolve(here, "..", "fixtures");
export const PAULMILLR_DIR = join(FIXTURE_ROOT, "upstream", "paulmillr");
export const MULLVAD_DIR = join(FIXTURE_ROOT, "upstream", "mullvad");

export interface Fixture {
  readonly name: string;
  readonly path: string;
  readonly text: string;
}

function list(dir: string, suffix: string): Fixture[] {
  let entries: string[];
  try {
    entries = [...Deno.readDirSync(dir)]
      .filter((entry) => entry.isFile && entry.name.endsWith(suffix))
      .map((entry) => entry.name);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }

  return entries.sort().map((file) => ({
    name: file.slice(0, -suffix.length),
    path: join(dir, file),
    text: decodeLossy(Deno.readFileSync(join(dir, file))),
  }));
}

function decodeLossy(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function plainXmlFixtures(): Fixture[] {
  return list(PAULMILLR_DIR, ".mobileconfig");
}

export function signedFixtures(): Fixture[] {
  return list(MULLVAD_DIR, ".mobileconfig");
}

export function extractedFixtures(): Fixture[] {
  return list(MULLVAD_DIR, ".inner.plist");
}

export function hasSignedFixtures(): boolean {
  return signedFixtures().length > 0;
}

export function fixture(name: string): Fixture {
  const found = [...plainXmlFixtures(), ...extractedFixtures()].find(
    (f) => f.name === name,
  );
  if (!found) throw new Error(`No such fixture: ${name}`);
  return found;
}

export function looksLikeDer(text: string): boolean {
  return text.charCodeAt(0) === 0x30;
}
