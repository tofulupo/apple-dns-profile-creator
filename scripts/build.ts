#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
import { copy } from "@std/fs/copy";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { type Page, PAGES, SITE_URL } from "../pages/pages.ts";
import {
  appConfig,
  type DnsPreset,
  PRESET_FEATURE_LABELS,
  type PresetFeature,
} from "../src/config.ts";
import { FONT_SUBSET } from "./fonts.ts";
import {
  BERKELEY_MONO,
  downloadFonts,
  r2Config,
  WEB_FONTS,
} from "./web_fonts.ts";

const ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const PAGES_DIR = join(ROOT, "pages");
const LAYOUT = "pages/_layout.html";
const MASCOT = "pages/_mascot.html";
const PREPAINT = "pages/_prepaint.html";
const SETTINGS = "pages/_settings.html";
const SETTINGS_SCRIPT = "src/ui/settings_window.ts";
const LLMS = "pages/llms.txt";
const STYLESHEET = "css/app.css";
/**
 * Committed with their licences: Lilex, and Geist's licence for Geist Pixel.
 * The website's fonts are licensed and come from scripts/web_fonts.ts.
 */
const FONTS = join(ROOT, "fonts");
/**
 * From flag-icons (MIT, licence beside them), 4x3 variant.
 * `test/config.test.ts` names any preset's flag that is missing.
 */
export const FLAGS = join(ROOT, "flags");
const REPOSITORY_URL = "https://github.com/tofulupo/apple-dns-profile-creator";

/** Help > Release Notes in src-tauri/src/menu.rs opens the same address. */
export function releaseNotesUrl(version: string): string {
  return `${REPOSITORY_URL}/blob/v${version}/CHANGELOG.md`;
}

export interface PageAssets {
  readonly stylesheet: string;
  readonly script: string;
  readonly version: string;
  readonly desktop?: boolean;
  readonly fonts?: readonly string[];
}

function preload(file: string): string {
  return `<link rel="preload" href="fonts/${file}" as="font"\n` +
    `      type="font/woff2" crossorigin>`;
}

export function fontPreloads(
  desktop: boolean,
  shipped?: readonly string[],
): string {
  return [
    "Soehne-Buch.woff2",
    desktop ? "Lilex-Latin.woff2" : BERKELEY_MONO,
  ].filter((file) => shipped === undefined || shipped.includes(file))
    .map(preload).join("\n    ");
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

async function bundleScript(entrypoint: string): Promise<string> {
  const { success, stdout } = await new Deno.Command(Deno.execPath(), {
    args: [
      "bundle",
      "--platform",
      "browser",
      "--minify",
      "--format",
      "iife",
      entrypoint,
    ],
    cwd: ROOT,
    stdout: "piped",
    stderr: "inherit",
  }).output();

  if (!success) throw new Error(`deno bundle failed for ${entrypoint}`);
  return new TextDecoder().decode(stdout).trim();
}

export function inlineScript(code: string): string {
  if (/<\/?script/i.test(code)) {
    throw new Error("The page script contains markup that breaks inlining");
  }
  return `<script>${code}</script>`;
}

export function svgDataUri(svg: string): string {
  return `url("${svgDataUrl(svg)}")`;
}

export function svgDataUrl(svg: string): string {
  if (svg.includes("'")) {
    throw new Error("SVG uses single quotes, which the data URI relies on");
  }
  const compact = svg.replace(/\s+/g, " ").replaceAll("> <", "><").trim()
    .replaceAll('"', "'")
    .replace(/[%#<>{}]/g, (character) => encodeURIComponent(character));
  return `data:image/svg+xml,${compact}`;
}

export async function inlineIcons(
  css: string,
  read: (file: string) => Promise<string>,
): Promise<string> {
  // `url(icons/….svg)`, quoted or not.
  const reference = /url\(\s*(["']?)(icons\/[\w.-]+\.svg)\1\s*\)/g;
  const files = new Set([...css.matchAll(reference)].map((match) => match[2]!));
  const uris = new Map<string, string>();
  for (const file of files) uris.set(file, svgDataUri(await read(file)));
  return css.replace(
    reference,
    (_match, _quote, file: string) => uris.get(file)!,
  );
}

export function servedFontName(name: string): string {
  const ascii = name.normalize("NFC")
    .replaceAll("ä", "ae").replaceAll("ö", "oe").replaceAll("ü", "ue")
    .replaceAll("Ä", "Ae").replaceAll("Ö", "Oe").replaceAll("Ü", "Ue")
    .replaceAll("ß", "ss");
  if (!/^[\w.-]+$/.test(ascii)) {
    throw new Error(`Font file name has characters to rename: ${name}`);
  }
  return ascii;
}

const FONT_FILE = /\.(woff2|ttf|txt)$/;

export async function copyFonts(
  from: string,
  to: string,
): Promise<string[]> {
  await Deno.mkdir(to, { recursive: true });
  const copied: string[] = [];
  try {
    for await (const entry of Deno.readDir(from)) {
      if (!entry.isFile || !FONT_FILE.test(entry.name)) continue;
      const name = servedFontName(entry.name);
      await Deno.copyFile(join(from, entry.name), join(to, name));
      copied.push(name);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return copied.sort();
}

/** The file names in the stylesheet's `url("fonts/…")` references. */
export function fontUrls(css: string): string[] {
  return [
    ...new Set([...css.matchAll(/url\(\s*["']?fonts\/([^"')]+)/g)]
      .map((match) => match[1]!)),
  ].sort();
}

export function withoutMissingFonts(
  css: string,
  shipped: readonly string[],
): string {
  return css.replace(
    /@font-face\s*\{[^}]*\}\s*/g,
    (rule) =>
      fontUrls(rule).every((file) => shipped.includes(file)) ? rule : "",
  );
}

export function missingFonts(
  css: string,
  shipped: readonly string[],
): string[] {
  return fontUrls(css).filter((file) => !shipped.includes(file));
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
    const count = page.countId === undefined
      ? ""
      : `<span class="tab__count" id="${
        escape(page.countId)
      }" aria-hidden="true" hidden></span>`;
    return `<a href="${
      escape(pageHref(page))
    }" class="tab"${state}>${icon}<span class="tab__label">${
      escape(page.nav)
    }</span>${count}</a>`;
  }).join("\n");
}

export async function readVersion(): Promise<string> {
  const manifest = JSON.parse(
    await Deno.readTextFile(join(ROOT, "deno.json")),
  ) as { version?: unknown };
  if (typeof manifest.version !== "string") {
    throw new Error("deno.json has no version string");
  }
  return manifest.version;
}

const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string): string | undefined {
  if (!/^[A-Z]{2}$/.test(code)) return undefined;
  const name = REGION_NAMES.of(code);
  return name === undefined || name === code ? undefined : name;
}

export function presetHost(preset: DnsPreset): string {
  return preset.protocol === "HTTPS"
    ? new URL(preset.serverUrl).hostname
    : preset.serverUrl;
}

export function presetFeatures(preset: DnsPreset): string[] {
  return (Object.keys(PRESET_FEATURE_LABELS) as PresetFeature[])
    .filter((feature) => preset.features?.includes(feature))
    .map((feature) => PRESET_FEATURE_LABELS[feature]);
}

function presetCountry(preset: DnsPreset): string | undefined {
  return preset.country === undefined
    ? undefined
    : countryName(preset.country) ?? preset.country;
}

export function flagFile(code: string): string {
  return join(FLAGS, `${code.toLowerCase()}.svg`);
}

function presetMark(preset: DnsPreset): string {
  if (preset.country === undefined) {
    return `<span class="icon icon--globe preset__mark" aria-hidden="true"></span>`;
  }
  let svg: string;
  try {
    svg = Deno.readTextFileSync(flagFile(preset.country));
  } catch (error) {
    throw new Error(
      `No flag for ${preset.name}'s country ${preset.country}: copy flags/4x3/${preset.country.toLowerCase()}.svg from flag-icons into flags/`,
      { cause: error },
    );
  }
  return `<img class="preset__mark preset__flag" src="${
    escape(svgDataUrl(svg))
  }" alt="" title="${
    escape(presetCountry(preset) ?? preset.country)
  }" width="20" height="15">`;
}

/** In `appConfig.presets` order: `tool.ts` attaches the handlers by position. */
export function presetOptions(): string {
  return appConfig.presets.map((preset) => {
    const country = presetCountry(preset);
    const features = presetFeatures(preset);
    return `<li><button type="button" class="preset" aria-pressed="false">` +
      presetMark(preset) +
      `<span class="preset__head">` +
      `<span class="preset__name">${escape(preset.name)}${
        country === undefined
          ? ""
          : `<span class="visually-hidden">, ${escape(country)}</span>`
      }</span>` +
      (features.length === 0
        ? ""
        : `<span class="preset__features">${
          features.map((feature) =>
            `<span class="preset__feature">${escape(feature)}</span>`
          ).join("")
        }</span>`) +
      `</span>` +
      `<span class="preset__server"><span class="preset__protocol">${
        preset.protocol === "HTTPS" ? "DoH" : "DoT"
      }</span><span class="preset__host">${
        escape(presetHost(preset))
      }</span></span>` +
      `<span class="icon icon--check preset__check" aria-hidden="true"></span>` +
      `</button></li>`;
  }).join("\n");
}

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

export async function renderPage(
  page: Page,
  assets: PageAssets,
): Promise<string> {
  const [layout, content, mascot, prepaint] = await Promise.all([
    Deno.readTextFile(join(ROOT, LAYOUT)),
    Deno.readTextFile(join(PAGES_DIR, page.file)),
    assets.desktop
      ? Deno.readTextFile(join(ROOT, MASCOT))
      : Promise.resolve(""),
    Deno.readTextFile(join(ROOT, PREPAINT)),
  ]);
  const jsonLd = `<script type="application/ld+json">${
    JSON.stringify(structuredData(assets.version)).replaceAll("<", "\\u003c")
  }</script>`;
  return fill(layout, {
    title: escape(page.title),
    description: escape(page.description),
    canonical: escape(pageUrl(page)),
    structuredData: jsonLd,
    stylesheet: escape(assets.stylesheet),
    fontPreloads: fontPreloads(assets.desktop ?? false, assets.fonts),
    prepaint: prepaint.trim(),
    script: inlineScript(assets.script),
    version: escape(assets.version),
    nav: navigation(page),
    mascot: mascot.trim(),
    content: fill(content.trim(), { presets: presetOptions() }, page.file),
  }, LAYOUT);
}

export async function renderSettings(
  assets: Omit<PageAssets, "desktop">,
): Promise<string> {
  const [template, prepaint] = await Promise.all([
    Deno.readTextFile(join(ROOT, SETTINGS)),
    Deno.readTextFile(join(ROOT, PREPAINT)),
  ]);
  return fill(template, {
    stylesheet: escape(assets.stylesheet),
    fontPreloads: fontPreloads(true, assets.fonts),
    prepaint: prepaint.trim(),
    script: inlineScript(assets.script),
    version: escape(assets.version),
    releaseNotes: escape(releaseNotesUrl(assets.version)),
  }, SETTINGS);
}

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

/** Fills the `{{ site }}` placeholder in pages/llms.txt. */
export async function renderLlms(): Promise<string> {
  return fill(
    await Deno.readTextFile(join(ROOT, LLMS)),
    { site: SITE_URL },
    LLMS,
  );
}

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

export function pageUrl(page: Page): string {
  return new URL(pageHref(page), SITE_URL).href;
}

export function pageHref(page: Page): string {
  return page.file === "index.html" ? "./" : page.file;
}

/** IndexNow's key format: 8 to 128 letters, digits or dashes. */
export const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

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
    const lastmod = await lastCommitDate([
      LAYOUT,
      PREPAINT,
      `pages/${page.file}`,
    ]);
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

  await bundle([STYLESHEET], ["--external=icons/*", "--external=fonts/*"]);

  const bundled = join(DIST, "app.css");
  const fullCss = await inlineIcons(
    await Deno.readTextFile(bundled),
    (file) => Deno.readTextFile(join(ROOT, "public", file)),
  );
  await Deno.remove(bundled);

  // Set by the Tauri CLI for beforeBuildCommand and beforeDevCommand.
  const desktop = Deno.env.get("TAURI_ENV_PLATFORM") !== undefined;
  const fonts = join(DIST, "fonts");
  const shipped = await copyFonts(FONTS, fonts);
  if (desktop) {
    shipped.push(...await copyFonts(FONT_SUBSET, fonts));
    const missing = missingFonts(fullCss, shipped).filter((file) =>
      file !== BERKELEY_MONO
    );
    if (missing.length > 0) {
      const message = `Fonts missing from the app: ${missing.join(", ")}. ` +
        "Put the Söhne .woff2 files in fonts/source/ and run `deno task fonts`.";
      if (Deno.env.get("TAURI_ENV_DEBUG") !== "true") throw new Error(message);
      console.warn(`\n\u26a0 ${message}\n`);
    }
  } else {
    const config = r2Config((name) => Deno.env.get(name));
    if (config !== undefined) {
      shipped.push(...await downloadFonts(config, WEB_FONTS, fonts));
    }
  }

  const css = withoutMissingFonts(fullCss, shipped);
  const stylesheet = `app-${await fingerprint(
    new TextEncoder().encode(css),
  )}.css`;
  await Deno.writeTextFile(join(DIST, stylesheet), css);

  const version = await readVersion();
  for (const page of PAGES) {
    await Deno.writeTextFile(
      join(DIST, page.file),
      await renderPage(page, {
        stylesheet: `./${stylesheet}`,
        script: await bundleScript(page.script),
        version,
        desktop,
        fonts: shipped,
      }),
    );
  }

  if (desktop) {
    await Deno.writeTextFile(
      join(DIST, "settings.html"),
      await renderSettings({
        stylesheet: `./${stylesheet}`,
        script: await bundleScript(SETTINGS_SCRIPT),
        version,
        fonts: shipped,
      }),
    );
  }

  for await (const entry of Deno.readDir(join(ROOT, "public"))) {
    if (entry.name.startsWith(".")) continue;
    await copy(join(ROOT, "public", entry.name), join(DIST, entry.name), {
      overwrite: true,
    });
  }

  await Deno.writeTextFile(join(DIST, "sitemap.xml"), await sitemap());
  await Deno.writeTextFile(join(DIST, "robots.txt"), renderRobots());
  await Deno.writeTextFile(join(DIST, "llms.txt"), await renderLlms());

  const key = Deno.env.get("INDEXNOW_KEY");
  if (key !== undefined && key !== "") {
    const file = indexNowKeyFile(key.trim());
    await Deno.writeTextFile(join(DIST, file.name), file.content);
  }
}

if (import.meta.main) await build();
