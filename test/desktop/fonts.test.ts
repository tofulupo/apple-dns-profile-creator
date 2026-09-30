/**
 * Tests for the desktop app's fonts: how they are copied into its build, and
 * that the stylesheet refers to them by the names they are served under.
 */
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join, resolve } from "@std/path";

import { copyFonts, servedFontName } from "../../scripts/build.ts";

const here = import.meta.dirname;
if (here === undefined) throw new Error("Must be loaded from a file URL");
const ROOT = resolve(here, "..", "..");
const FONTS = join(ROOT, "fonts");

describe("servedFontName", () => {
  it("spells out umlauts, however they are stored", () => {
    // Composed, and as the Klim download stores them: o + combining diaeresis.
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
    await Deno.writeTextFile(join(from, "So\u0308hne-Buch.ttf"), "ttf");
    await Deno.writeTextFile(join(from, "Lilex-Latin.woff2"), "woff2");
    await Deno.writeTextFile(join(from, "Lilex-OFL.txt"), "licence");
    await Deno.writeTextFile(join(from, "README.md"), "notes");
    await Deno.writeTextFile(join(from, ".DS_Store"), "");

    expect(await copyFonts(from, to)).toEqual([
      "Lilex-Latin.woff2",
      "Lilex-OFL.txt",
      "Soehne-Buch.ttf",
    ]);
    expect(await Deno.readTextFile(join(to, "Soehne-Buch.ttf"))).toBe("ttf");
  });

  it("copies nothing from an empty folder", async () => {
    expect(await copyFonts(from, to)).toEqual([]);
  });
});

describe("desktop/fonts", () => {
  const css = Deno.readTextFileSync(join(ROOT, "css", "app.css"));
  const urls = [...css.matchAll(/url\("fonts\/([^"]+)"\)/g)].map((m) => m[1]!);

  it("is what the stylesheet's font urls point at", () => {
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(servedFontName(url)).toBe(url);
  });

  // Söhne is licensed for the app only and kept out of the repository, so
  // only Lilex has to be here.
  it("has Lilex, with the licence the OFL requires to ship with it", () => {
    expect(urls).toContain("Lilex-Latin.woff2");
    for (const file of ["Lilex-Latin.woff2", "Lilex-OFL.txt"]) {
      expect(Deno.statSync(join(FONTS, file)).isFile).toBe(true);
    }
  });
});
