#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
// Builds the static site into dist/.
import { copy } from "@std/fs/copy";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const PAGES = ["index.html", "finalize.html"];
const STYLESHEET = "css/app.css";

async function bundle(entrypoints: string[]): Promise<void> {
  const { success } = await new Deno.Command(Deno.execPath(), {
    args: [
      "bundle",
      "--platform",
      "browser",
      "--minify",
      "--outdir",
      "dist",
      ...entrypoints,
    ],
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  }).output();

  if (!success) {
    throw new Error(`deno bundle failed for ${entrypoints.join(", ")}`);
  }
}

async function fingerprint(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(
    digest.subarray(0, 4),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function build(): Promise<void> {
  try {
    await Deno.remove(DIST, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  await Deno.mkdir(DIST, { recursive: true });

  await bundle(PAGES);

  await bundle([STYLESHEET]);

  const bundled = join(DIST, "app.css");
  const hashed = `app-${await fingerprint(await Deno.readFile(bundled))}.css`;
  await Deno.rename(bundled, join(DIST, hashed));

  for (const page of PAGES) {
    const path = join(DIST, page);
    const html = await Deno.readTextFile(path);
    if (!html.includes(STYLESHEET)) {
      throw new Error(`${page} has no ${STYLESHEET} reference to rewrite`);
    }
    await Deno.writeTextFile(path, html.replaceAll(STYLESHEET, `./${hashed}`));
  }

  for await (const entry of Deno.readDir(join(ROOT, "public"))) {
    await copy(join(ROOT, "public", entry.name), join(DIST, entry.name), {
      overwrite: true,
    });
  }
}

if (import.meta.main) await build();
