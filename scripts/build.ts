#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
// Builds the static site into dist/.
import { copy } from "@std/fs/copy";
import {
  dirname,
  fromFileUrl,
  join,
  relative,
  resolve,
  SEPARATOR,
} from "@std/path";
import { type Page, PAGES, SITE_URL } from "../pages/pages.ts";

const ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const PAGES_DIR = join(ROOT, "pages");
const LAYOUT = "pages/_layout.html";
// Rendered pages are staged inside dist/ so their script paths resolve from a
// fixed location. The bundler writes them flat into dist/, and the stage is
// removed afterwards.
const STAGE = join(DIST, ".pages");
const STYLESHEET = "css/app.css";

export interface PageAssets {
  /** Stylesheet URL, relative to the page. */
  readonly stylesheet: string;
  /** Entry module path, relative to the page. */
  readonly script: string;
  /** Shown next to the page heading. */
  readonly version: string;
}

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

function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fill(template: string, values: Record<string, string>): string {
  // deno fmt pads placeholders to `{{ key }}`, so allow either spelling.
  return template.replaceAll(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`${LAYOUT} uses unknown placeholder {{${key}}}`);
    }
    return value;
  });
}

function navigation(current: Page): string {
  return PAGES.map((page) => {
    const state = page === current ? ' aria-current="page"' : "";
    return `<a href="${escape(page.file)}" class="tab"${state}>${
      escape(page.nav)
    }</a>`;
  }).join("\n");
}

/** The single source of the app version, so nothing else has to repeat it. */
export async function readVersion(): Promise<string> {
  const manifest = JSON.parse(
    await Deno.readTextFile(join(ROOT, "deno.json")),
  ) as { version?: unknown };
  if (typeof manifest.version !== "string") {
    throw new Error("deno.json has no version string");
  }
  return manifest.version;
}

/** Renders a page's content fragment into the shared layout. */
export async function renderPage(
  page: Page,
  assets: PageAssets,
): Promise<string> {
  const [layout, content] = await Promise.all([
    Deno.readTextFile(join(ROOT, LAYOUT)),
    Deno.readTextFile(join(PAGES_DIR, page.file)),
  ]);
  return fill(layout, {
    description: escape(page.description),
    stylesheet: escape(assets.stylesheet),
    script: escape(assets.script),
    version: escape(assets.version),
    nav: navigation(page),
    content: content.trim(),
  });
}

/**
 * Date of the last commit touching `paths`, or undefined when git or the
 * history is unavailable, as in a source tarball.
 */
async function lastCommitDate(paths: string[]): Promise<string | undefined> {
  try {
    const { success, stdout } = await new Deno.Command("git", {
      args: ["log", "-1", "--format=%cs", "--", ...paths],
      cwd: ROOT,
      stdout: "piped",
      stderr: "null",
    }).output();
    const date = new TextDecoder().decode(stdout).trim();
    return success && date !== "" ? date : undefined;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

async function sitemap(): Promise<string> {
  const entries = await Promise.all(PAGES.map(async (page) => {
    const loc = page.file === "index.html"
      ? SITE_URL
      : new URL(page.file, SITE_URL).href;
    const lastmod = await lastCommitDate([LAYOUT, `pages/${page.file}`]);
    return [
      "  <url>",
      `    <loc>${escape(loc)}</loc>`,
      ...(lastmod === undefined ? [] : [`    <lastmod>${lastmod}</lastmod>`]),
      "    <changefreq>monthly</changefreq>",
      `    <priority>${page.priority.toFixed(1)}</priority>`,
      "  </url>",
    ].join("\n");
  }));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    "</urlset>",
    "",
  ].join("\n");
}

export async function build(): Promise<void> {
  try {
    await Deno.remove(DIST, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  await Deno.mkdir(DIST, { recursive: true });

  await bundle([STYLESHEET]);

  const bundled = join(DIST, "app.css");
  const stylesheet = `app-${await fingerprint(
    await Deno.readFile(bundled),
  )}.css`;
  await Deno.rename(bundled, join(DIST, stylesheet));

  const version = await readVersion();
  await Deno.mkdir(STAGE);
  try {
    const staged: string[] = [];
    for (const page of PAGES) {
      const path = join(STAGE, page.file);
      const script = relative(STAGE, join(ROOT, page.script))
        .replaceAll(SEPARATOR, "/");
      await Deno.writeTextFile(
        path,
        await renderPage(page, {
          stylesheet: `./${stylesheet}`,
          script,
          version,
        }),
      );
      staged.push(path);
    }
    await bundle(staged);
  } finally {
    await Deno.remove(STAGE, { recursive: true });
  }

  for await (const entry of Deno.readDir(join(ROOT, "public"))) {
    // Dotfiles are skipped so stray .DS_Store files do not get published.
    if (entry.name.startsWith(".")) continue;
    await copy(join(ROOT, "public", entry.name), join(DIST, entry.name), {
      overwrite: true,
    });
  }

  await Deno.writeTextFile(join(DIST, "sitemap.xml"), await sitemap());
}

if (import.meta.main) await build();
