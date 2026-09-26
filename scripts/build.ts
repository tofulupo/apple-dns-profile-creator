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
import { appConfig } from "../src/config.ts";

const ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const PAGES_DIR = join(ROOT, "pages");
const LAYOUT = "pages/_layout.html";
/** Rendered with the site's address into dist/llms.txt. */
const LLMS = "pages/llms.txt";
// Rendered pages are staged inside dist/ so their script paths resolve from a
// fixed location. The bundler writes them flat into dist/, and the stage is
// removed afterwards.
const STAGE = join(DIST, ".pages");
const STYLESHEET = "css/app.css";
const REPOSITORY_URL = "https://github.com/tofulupo/apple-dns-profile-creator";

export interface PageAssets {
  /** Stylesheet URL, relative to the page. */
  readonly stylesheet: string;
  /** Entry module path, relative to the page. */
  readonly script: string;
  /** Shown next to the page heading. */
  readonly version: string;
}

async function bundle(
  entrypoints: string[],
  flags: string[] = [],
): Promise<void> {
  const { success } = await new Deno.Command(Deno.execPath(), {
    args: [
      "bundle",
      "--platform",
      "browser",
      "--minify",
      "--outdir",
      "dist",
      ...flags,
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

function fill(
  template: string,
  values: Record<string, string>,
  source: string,
): string {
  // deno fmt pads placeholders to `{{ key }}`, so allow either spelling.
  return template.replaceAll(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`${source} uses unknown placeholder {{${key}}}`);
    }
    return value;
  });
}

function navigation(current: Page): string {
  return PAGES.map((page) => {
    const state = page === current ? ' aria-current="page"' : "";
    const icon = `<span class="icon icon--${
      escape(page.icon)
    }" aria-hidden="true"></span>`;
    return `<a href="${escape(page.file)}" class="tab"${state}>${icon}${
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

/**
 * The quick-preset buttons, in `appConfig.presets` order. Rendered here
 * rather than by the page script so the row is in place at first paint and
 * does not push the form down; `tool.ts` attaches the handlers by position.
 */
export function presetChips(): string {
  return appConfig.presets.map((preset) =>
    `<button type="button" class="chip" aria-pressed="false">${
      escape(preset.name)
    }</button>`
  ).join("\n");
}

/**
 * schema.org description of the tool, embedded as JSON-LD so search engines
 * and AI answer engines can tell what the site is. Describes the start page,
 * whichever page it is embedded in.
 */
export function structuredData(version: string): Record<string, unknown> {
  const start = PAGES.find((page) => page.file === "index.html");
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "DNS Profile Creator",
    description: start?.description,
    url: SITE_URL,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "iOS, macOS",
    softwareVersion: version,
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    sameAs: [REPOSITORY_URL],
  };
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
  // The whole element is generated, since deno fmt parses the body of a JSON
  // script and fails on a placeholder there. `<` is escaped so no value can
  // close the element early.
  const jsonLd = `<script type="application/ld+json">${
    JSON.stringify(structuredData(assets.version)).replaceAll("<", "\\u003c")
  }</script>`;
  return fill(layout, {
    title: escape(page.title),
    description: escape(page.description),
    canonical: escape(pageUrl(page)),
    structuredData: jsonLd,
    stylesheet: escape(assets.stylesheet),
    script: escape(assets.script),
    version: escape(assets.version),
    nav: navigation(page),
    content: fill(content.trim(), { presets: presetChips() }, page.file),
  }, LAYOUT);
}

/**
 * Crawlers welcomed by name in robots.txt. `User-agent: *` already allows
 * everyone; some tools still look for their own entry. Each is the crawler's
 * name (its robots.txt product token), not its full user-agent string, which
 * is what crawlers match against.
 */
export const NAMED_CRAWLERS: readonly string[] = [
  "Kagibot",
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "PerplexityBot",
  "Google-Extended",
  "Google-InspectionTool",
  "Bytespider",
  "CCBot",
  "Amazonbot",
  "Applebot-Extended",
  "FacebookBot",
  "Meta-ExternalAgent",
  "cohere-ai",
  "YouBot",
  "Diffbot",
  "PetalBot",
  "Barkrowler",
  "Timpibot",
  "Seekr",
  "Kangaroo",
  "Velenpublicwebcrawler",
  "omgili",
  "ICC-Crawler",
  "BrightBot",
  "Scrapy",
  "xAI-Bot",
  "DuckAssistBot",
  "bingbot",
  "Ai2Bot",
  "MistralBot",
  "Googlebot",
  "Applebot",
  "AhrefsBot",
  "SemrushBot",
  "YandexBot",
  "Baiduspider",
  "BraveBot",
  "Yeti",
  "HuggingFaceBot",
  "DuckDuckBot",
  "Mozilla",
  "archive.org_bot",
  "TurnitinBot",
  "iaskspider",
  "Sogou web spider",
  "DataForSeoBot",
  "MJ12bot",
  "rogerbot",
  "DeepSeekBot",
  "Firecrawl",
  "JinaBot",
  "Exa-Search",
  "MojeekBot",
  "ApifyBot",
  "QwenBot",
  "YandexGPT",
  "img2dataset",
  "news-please",
  "Slurp",
  "Twitterbot",
];

/** robots.txt, pointing crawlers at the sitemap on the deployed site. */
export function renderRobots(): string {
  const groups = ["*", ...NAMED_CRAWLERS].map((agent) =>
    `User-agent: ${agent}\nAllow: /\n`
  );
  return [
    ...groups,
    `Sitemap: ${new URL("sitemap.xml", SITE_URL).href}`,
    "",
  ].join("\n");
}

/** llms.txt, with `{{ site }}` in the template replaced by `SITE_URL`. */
export async function renderLlms(): Promise<string> {
  return fill(
    await Deno.readTextFile(join(ROOT, LLMS)),
    { site: SITE_URL },
    LLMS,
  );
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

/** A page's public URL; the start page is the site root itself. */
export function pageUrl(page: Page): string {
  return page.file === "index.html"
    ? SITE_URL
    : new URL(page.file, SITE_URL).href;
}

/**
 * IndexNow keys: 8 to 128 letters, digits or dashes. The key is public by
 * design (search engines fetch it from the site to confirm ownership), but
 * it is kept out of the repository: Deno Deploy passes it to the build as
 * the INDEXNOW_KEY environment variable.
 */
export const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

/** The file IndexNow looks for at the site root: `<key>.txt`, holding the key. */
export function indexNowKeyFile(
  key: string,
): { name: string; content: string } {
  if (!INDEXNOW_KEY_PATTERN.test(key)) {
    throw new Error(
      "INDEXNOW_KEY must be 8 to 128 letters, digits or dashes.",
    );
  }
  return { name: `${key}.txt`, content: key };
}

async function sitemap(): Promise<string> {
  const entries = await Promise.all(PAGES.map(async (page) => {
    const loc = pageUrl(page);
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

  // Icons are copied from public/ unchanged. Marked external, their url()s stay
  // relative to the stylesheet, which lands next to icons/ in dist/.
  // The `=` form matters: `--external` takes several values and would
  // otherwise swallow the entrypoint after it.
  await bundle([STYLESHEET], ["--external=icons/*"]);

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

  // Generated rather than copied from public/, so the site's address lives
  // only in SITE_URL.
  await Deno.writeTextFile(join(DIST, "sitemap.xml"), await sitemap());
  await Deno.writeTextFile(join(DIST, "robots.txt"), renderRobots());
  await Deno.writeTextFile(join(DIST, "llms.txt"), await renderLlms());

  // Only where the key is configured, i.e. on Deno Deploy; local builds and
  // CI skip it.
  const key = Deno.env.get("INDEXNOW_KEY");
  if (key !== undefined && key !== "") {
    const file = indexNowKeyFile(key.trim());
    await Deno.writeTextFile(join(DIST, file.name), file.content);
  }
}

if (import.meta.main) await build();
