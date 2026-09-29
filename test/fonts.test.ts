/**
 * Tests for the fonts: how they are copied into the build, and that every
 * font the stylesheet asks for is in fonts/, with its licence.
 */
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join, resolve } from "@std/path";

import { copyFonts, fontUrls, servedFontName } from "../scripts/build.ts";

const here = import.meta.dirname;
if (here === undefined) throw new Error("Must be loaded from a file URL");
const ROOT = resolve(here, "..");
const FONTS = join(ROOT, "fonts");
const CSS = Deno.readTextFileSync(join(ROOT, "css", "app.css"));

describe("servedFontName", () => {
  it("spells out umlauts, however they are stored", () => {
    for (const name of ["Söhne-Kräftig.ttf", "So\u0308hne-Kra\u0308ftig.ttf"]) {
      expect(servedFontName(name)).toBe("Soehne-Kraeftig.ttf");
    }
  });

  it("keeps plain names", () => {
    expect(servedFontName("Lilex-Latin.woff2")).toBe("Lilex-Latin.woff2");
  });

  it("refuses names it cannot make safe", () => {
    expect(() => servedFontName("Font (1).ttf")).toThrow();
  });
});

describe("copyFonts", () => {
  let from: string;
  let to: string;

  beforeEach(async () => {
    from = await Deno.makeTempDir({ prefix: "dns-fonts-from-" });
    to = join(await Deno.makeTempDir({ prefix: "dns-fonts-to-" }), "fonts");
  });

  afterEach(async () => {
    await Deno.remove(from, { recursive: true });
    await Deno.remove(join(to, ".."), { recursive: true });
  });

  it("copies fonts and licences under their served names only", async () => {
    await Deno.writeTextFile(join(from, "Lilex-Latin.woff2"), "woff2");
    await Deno.writeTextFile(join(from, "Lilex-OFL.txt"), "licence");
    await Deno.writeTextFile(join(from, "README.md"), "notes");
    await Deno.writeTextFile(join(from, ".DS_Store"), "");

    expect(await copyFonts(from, to)).toEqual([
      "Lilex-Latin.woff2",
      "Lilex-OFL.txt",
    ]);
    expect(await Deno.readTextFile(join(to, "Lilex-Latin.woff2"))).toBe(
      "woff2",
    );
  });

  it("copies nothing from a folder that does not exist", async () => {
    expect(await copyFonts(join(from, "missing"), to)).toEqual([]);
  });
});

describe("the stylesheet's fonts", () => {
  const urls = fontUrls(CSS);

  it("are referenced by their served names", () => {
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(servedFontName(url)).toBe(url);
  });

  it("are all in fonts/", () => {
    for (const url of urls) {
      expect(Deno.statSync(join(FONTS, url)).isFile).toBe(true);
    }
  });

  it("include Lilex, with the licence the OFL requires to ship with it", () => {
    expect(urls).toContain("Lilex-Latin.woff2");
    expect(Deno.statSync(join(FONTS, "Lilex-OFL.txt")).isFile).toBe(true);
  });
});
