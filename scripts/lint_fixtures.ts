#!/usr/bin/env -S deno run --allow-read --allow-run
/**
 * Validates every plain-XML fixture with Apple's own property list parser.
 */
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");

if (Deno.build.os !== "darwin") {
  console.log("plutil is macOS only - skipping.");
  Deno.exit(0);
}

function filesIn(dir: string, suffix: string): string[] {
  try {
    return [...Deno.readDirSync(dir)]
      .filter((entry) => entry.isFile && entry.name.endsWith(suffix))
      .map((entry) => join(dir, entry.name))
      .sort();
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
}

const files = [
  ...filesIn(join(ROOT, "test/fixtures/upstream/paulmillr"), ".mobileconfig"),
  ...filesIn(join(ROOT, "test/fixtures/upstream/mullvad"), ".inner.plist"),
];

if (files.length === 0) {
  console.error("No fixtures found. Run: deno task fixtures:fetch");
  Deno.exit(1);
}

const result = await new Deno.Command("plutil", {
  args: ["-lint", ...files],
  stdout: "inherit",
  stderr: "inherit",
}).output();

Deno.exit(result.code);
