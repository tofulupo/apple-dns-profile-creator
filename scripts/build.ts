#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
// Builds the static site into dist/.
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
/** Rendered with the site's address into dist/llms.txt. */
const LLMS = "pages/llms.txt";
const STYLESHEET = "css/app.css";
/**
 * Fonts committed with their licences: Lilex, the desktop app's monospace,
 * and Geist's licence, which covers the app's Geist Pixel. The website's fonts
 * are licensed and come from elsewhere (scripts/web_fonts.ts).
 */
const FONTS = join(ROOT, "fonts");
/**
 * Country flags for the presets menu, from flag-icons (MIT, licence beside
 * them), 4x3 variant. Only the countries the presets name are committed;
 * `test/config.test.ts` names any that is missing.
 */
export const FLAGS = join(ROOT, "flags");
const REPOSITORY_URL = "https://github.com/tofulupo/apple-dns-profile-creator";

export interface PageAssets {
  /** Stylesheet URL, relative to the page. */
  readonly stylesheet: string;
  /** The page's script, bundled into one classic script (see inlineScript). */
  readonly script: string;
  /** Shown next to the page heading. */
  readonly version: string;
  /**
   * Built for the desktop app, whose monospace is Lilex rather than the
   * website's Berkeley Mono.
   */
  readonly desktop?: boolean;
  /** The font files the build ships, for the preloads. All when undefined. */
  readonly fonts?: readonly string[];
}

function preload(file: string): string {
  return `<link rel="preload" href="fonts/${file}" as="font"\n` +
    `      type="font/woff2" crossorigin>`;
}

/**
 * The fonts every page shows, fetched alongside the stylesheet rather than
 * after it: the text's regular weight, and the monospace of the version badge
 * and the header's protocols. Each build only preloads its own monospace; the
 * other would load for nothing and warn that it went unused. Of `shipped`,
 * where given, so a build without the licensed fonts asks for none.
 */
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

/** Bundles `entrypoint` and its imports into one classic script. */
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

/**
 * The page script as an inline `<script>` at the end of the body. There it
 * runs while the page is parsed, before the first paint, so everything it
 * builds from stored data (the configuration list, the Profile tab's count)
 * is in place when the page is first drawn. As a module script, even from
 * cache, it ran after parsing, and browsers may paint before that: those parts
 * then appeared a frame late, on some reloads in Chromium and on every reload
 * in WebKit.
 */
export function inlineScript(code: string): string {
  // `</script` ends the element early. `<script` after a `<!--` (which the
  // plist parser has) would make the parser skip the real end tag.
  if (/<\/?script/i.test(code)) {
    throw new Error("The page script contains markup that breaks inlining");
  }
  return `<script>${code}</script>`;
}

/**
 * An SVG as a CSS `url()` data URI. Only the characters that would break the
 * URI or the quoted string are escaped, which keeps it far smaller than
 * encoding everything.
 */
export function svgDataUri(svg: string): string {
  return `url("${svgDataUrl(svg)}")`;
}

/** `svgDataUri` without the `url()`, for an `<img src>`. */
export function svgDataUrl(svg: string): string {
  if (svg.includes("'")) {
    throw new Error("SVG uses single quotes, which the data URI relies on");
  }
  const compact = svg.replace(/\s+/g, " ").replaceAll("> <", "><").trim()
    .replaceAll('"', "'")
    .replace(/[%#<>{}]/g, (character) => encodeURIComponent(character));
  return `data:image/svg+xml,${compact}`;
}

/**
 * Replaces the stylesheet's `url(icons/…svg)` references with the icons
 * themselves. As separate files they only load after the page has painted,
 * so every page change drew the tabs, the theme switch and the zone icon
 * empty for a frame: a visible flicker. Inlined, they are there from the
 * first paint, since the stylesheet itself blocks it.
 */
export async function inlineIcons(
  css: string,
  read: (file: string) => Promise<string>,
): Promise<string> {
  const reference = /url\(\s*(["']?)(icons\/[\w.-]+\.svg)\1\s*\)/g;
  const files = new Set([...css.matchAll(reference)].map((match) => match[2]!));
  const uris = new Map<string, string>();
  for (const file of files) uris.set(file, svgDataUri(await read(file)));
  return css.replace(
    reference,
    (_match, _quote, file: string) => uris.get(file)!,
  );
}

/**
 * A font file's name as served: ASCII only, so the stylesheet's url() always
 * matches it. Names with umlauts, like the Söhne files, may be stored with the
 * umlaut as a separate combining mark, which a url() written with the single
 * character does not match.
 */
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

/**
 * Copies the font files and their licences from `from` into `to` under their
 * served names, and returns those names. A missing `from` copies nothing:
 * fonts/subset/ only exists where the Söhne files are (see scripts/fonts.ts).
 */
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

/** The files the stylesheet's `url("fonts/…")` references point at. */
export function fontUrls(css: string): string[] {
  return [
    ...new Set([...css.matchAll(/url\(\s*["']?fonts\/([^"')]+)/g)]
      .map((match) => match[1]!)),
  ].sort();
}

/**
 * The stylesheet without the @font-face rules for files not among `shipped`,
 * so pages never ask for a font the build does not have: local builds lack
 * the website's licensed fonts.
 */
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

/** Of the stylesheet's font files, those not among `shipped`. */
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
    // Filled in and shown by the page script; the tab's aria-label then
    // carries the exact number.
    const count = page.countId === undefined
      ? ""
      : `<span class="tab__count" id="${
        escape(page.countId)
      }" aria-hidden="true" hidden></span>`;
    // The label in its own element, which the floating bar on small phones
    // hides visually, leaving the icon (css/app.css).
    return `<a href="${
      escape(pageHref(page))
    }" class="tab"${state}>${icon}<span class="tab__label">${
      escape(page.nav)
    }</span>${count}</a>`;
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

const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

/**
 * The English name of the country `code` stands for, or undefined when it is
 * not a region code at all (`Intl.DisplayNames` hands those back unchanged).
 */
export function countryName(code: string): string | undefined {
  if (!/^[A-Z]{2}$/.test(code)) return undefined;
  const name = REGION_NAMES.of(code);
  return name === undefined || name === code ? undefined : name;
}

/** The host a preset's server runs on, as the menu shows it after DoH/DoT. */
export function presetHost(preset: DnsPreset): string {
  return preset.protocol === "HTTPS"
    ? new URL(preset.serverUrl).hostname
    : preset.serverUrl;
}

/** What a preset offers, as the pills beside its name, in menu order. */
export function presetFeatures(preset: DnsPreset): string[] {
  return (Object.keys(PRESET_FEATURE_LABELS) as PresetFeature[])
    .filter((feature) => preset.features?.includes(feature))
    .map((feature) => PRESET_FEATURE_LABELS[feature]);
}

/** The country a preset runs in, spelled out, or undefined when global. */
function presetCountry(preset: DnsPreset): string | undefined {
  return preset.country === undefined
    ? undefined
    : countryName(preset.country) ?? preset.country;
}

/** The flag file for the country `code`, such as `flags/se.svg`. */
export function flagFile(code: string): string {
  return join(FLAGS, `${code.toLowerCase()}.svg`);
}

/**
 * What stands in front of a preset's name: the flag of its country, embedded
 * so it is there at first paint, or a globe for a global resolver. Both are
 * hidden from assistive tech, which gets the country as text beside the name
 * instead; the flag's title names it for a pointer, since some look alike
 * (Iceland and Norway).
 */
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

/**
 * The presets menu's entries, in `appConfig.presets` order. Rendered here
 * rather than by the page script so they are in place at first paint;
 * `tool.ts` attaches the handlers by position.
 */
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
    fontPreloads: fontPreloads(assets.desktop ?? false, assets.fonts),
    script: inlineScript(assets.script),
    version: escape(assets.version),
    nav: navigation(page),
    content: fill(content.trim(), { presets: presetOptions() }, page.file),
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
  return new URL(pageHref(page), SITE_URL).href;
}

/**
 * The page's address relative to the site root, as internal links use it.
 * The start page is the root itself rather than `index.html`: that is its
 * canonical URL, and a link to `index.html` would send visitors and crawlers
 * to a second address for the same page.
 */
export function pageHref(page: Page): string {
  return page.file === "index.html" ? "./" : page.file;
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

  // Marked external, the icons' url()s are left alone by the bundler and
  // inlined afterwards (see inlineIcons), and the fonts' url()s point at the
  // desktop app's copies (see below). The `=` form matters: `--external`
  // takes several values and would otherwise swallow the entrypoint after it.
  await bundle([STYLESHEET], ["--external=icons/*", "--external=fonts/*"]);

  const bundled = join(DIST, "app.css");
  const fullCss = await inlineIcons(
    await Deno.readTextFile(bundled),
    (file) => Deno.readTextFile(join(ROOT, "public", file)),
  );
  await Deno.remove(bundled);

  // The Tauri CLI sets TAURI_ENV_PLATFORM for its beforeBuildCommand and
  // beforeDevCommand.
  const desktop = Deno.env.get("TAURI_ENV_PLATFORM") !== undefined;
  const fonts = join(DIST, "fonts");
  const shipped = await copyFonts(FONTS, fonts);
  if (desktop) {
    shipped.push(...await copyFonts(FONT_SUBSET, fonts));
    // Berkeley Mono is the website's alone: the app uses Lilex.
    const missing = missingFonts(fullCss, shipped).filter((file) =>
      file !== BERKELEY_MONO
    );
    if (missing.length > 0) {
      const message = `Fonts missing from the app: ${missing.join(", ")}. ` +
        "Put the Söhne .woff2 files in fonts/source/ and run `deno task fonts`.";
      // A release must not quietly ship the system font; `desktop:dev` may.
      if (Deno.env.get("TAURI_ENV_DEBUG") !== "true") throw new Error(message);
      console.warn(`\n\u26a0 ${message}\n`);
    }
  } else {
    // From the R2 bucket, on Deno Deploy only, where its credentials are set
    // and any failure fails the build. Local and CI builds use the system
    // font.
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
