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
    expect(llms).toContain(`[The Tool]: ${SITE_URL}\n`);
    expect(llms).toContain(`[Finalize / Download]: ${SITE_URL}finalize.html`);
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
