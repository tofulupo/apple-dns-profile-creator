/**
 * The deployed site's address: one source (`SITE_URL`), and the files the
 * build derives from it for crawlers and LLMs.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join, resolve } from "@std/path";
import { walkSync } from "@std/fs/walk";

import { SITE_URL } from "../pages/pages.ts";
import { NAMED_CRAWLERS, renderLlms, renderRobots } from "../scripts/build.ts";

const here = import.meta.dirname;
if (here === undefined) throw new Error("Must be loaded from a file URL");
const ROOT = resolve(here, "..");

describe("SITE_URL", () => {
  it("is an https URL ending with a slash, so relative paths resolve", () => {
    const url = new URL(SITE_URL);
    expect(url.protocol).toBe("https:");
    expect(SITE_URL.endsWith("/")).toBe(true);
  });
});

describe("robots.txt", () => {
  it("allows crawling and points at the deployed sitemap", () => {
    const robots = renderRobots();
    expect(robots.startsWith("User-agent: *\nAllow: /\n")).toBe(true);
    expect(robots).toContain(`Sitemap: ${SITE_URL}sitemap.xml`);
  });

  it("gives every named crawler its own group, allowed everywhere", () => {
    const robots = renderRobots();
    for (const agent of NAMED_CRAWLERS) {
      expect(robots).toContain(`\nUser-agent: ${agent}\nAllow: /\n`);
    }
  });

  it("names each crawler once, by name rather than full user-agent string", () => {
    const lower = NAMED_CRAWLERS.map((agent) => agent.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
    // A version or URL means a whole user-agent string was pasted, which
    // crawlers do not match against.
    expect(NAMED_CRAWLERS.filter((agent) => /[/()+:;]/.test(agent)))
      .toEqual([]);
  });
});

describe("llms.txt", () => {
  it("links both pages on the deployed site, with no placeholder left", async () => {
    const llms = await renderLlms();
    expect(llms).not.toContain("{{");
    expect(llms).toContain(`- [The Tool](${SITE_URL}): `);
    expect(llms).toContain(
      `- [Finalize / Download](${SITE_URL}finalize.html): `,
    );
  });

  // The llms.txt format: every list entry is a Markdown link, and sections
  // are H2 headings. Lighthouse found no links in `- [Name]: url` entries.
  it("writes every list entry as a Markdown link under an H2 section", async () => {
    const llms = await renderLlms();
    const entries = llms.split("\n").filter((line) => line.startsWith("- "));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter((line) => !/^- \[[^\]]+\]\([^)\s]+\)/.test(line)))
      .toEqual([]);
    expect(llms).toContain("\n## Optional\n");
  });
});

// The site moved from GitHub Pages to Deno Deploy. Anything the build turns
// into the website must use SITE_URL, not a hard-coded old address.
describe("the retired GitHub Pages address", () => {
  it("appears nowhere the website is built from", () => {
    const offenders: string[] = [];
    for (const dir of ["pages", "public", "src", "css"]) {
      for (const entry of walkSync(join(ROOT, dir), { includeDirs: false })) {
        if (/\.(png|ico|car|icns)$/.test(entry.name)) continue;
        if (Deno.readTextFileSync(entry.path).includes("github.io")) {
          offenders.push(entry.path.slice(ROOT.length + 1));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the site's icons", () => {
  const layout = Deno.readTextFileSync(join(ROOT, "pages", "_layout.html"));
  const manifest = JSON.parse(
    Deno.readTextFileSync(join(ROOT, "public", "site.webmanifest")),
  ) as { icons: { src: string; sizes: string; purpose: string }[] };
  const linked = [
    ...layout.matchAll(/<link rel="[^"]*icon"[^>]*href="([^"]+)"/g),
  ]
    .map(([, href]) => href!);

  it("exist, whether linked from the pages or the manifest", () => {
    const files = [...linked, ...manifest.icons.map((icon) => icon.src)];
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      expect({ file, exists: exists(join(ROOT, "public", file)) }).toEqual({
        file,
        exists: true,
      });
    }
  });

  it("keep favicon.ico at the root, where crawlers look for it", () => {
    expect(linked).toContain("favicon.ico");
  });

  // Yandex shows a 120x120 favicon or an SVG in its results.
  it("offer Yandex a 120px icon and the SVG", () => {
    expect(linked).toContain("icons/favicon-120x120.png");
    expect(linked).toContain("icons/favicon.svg");
  });

  it("give Android both a plain and a maskable icon", () => {
    expect(manifest.icons.map((icon) => icon.purpose).sort()).toEqual([
      "any",
      "any",
      "maskable",
    ]);
  });
});

function exists(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}
