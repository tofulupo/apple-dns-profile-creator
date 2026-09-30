/**
 * Tests for the fonts: how they are copied into the build, that the
 * stylesheet refers to them by the names they are served under, and the check
 * that keeps a desktop release from shipping without Söhne.
 */
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join, resolve } from "@std/path";

import {
  copyFonts,
  fontUrls,
  missingFonts,
  servedFontName,
} from "../../scripts/build.ts";
import { SOEHNE_FACES } from "../../scripts/fonts.ts";

const here = import.meta.dirname;
if (here === undefined) throw new Error("Must be loaded from a file URL");
const ROOT = resolve(here, "..", "..");
const FONTS = join(ROOT, "fonts");
const CSS = Deno.readTextFileSync(join(ROOT, "css", "app.css"));

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
    await Deno.writeTextFile(join(from, "So\u0308hne-Buch.woff2"), "woff2");
    await Deno.writeTextFile(join(from, "Lilex-Latin.woff2"), "woff2");
    await Deno.writeTextFile(join(from, "Lilex-OFL.txt"), "licence");
    await Deno.writeTextFile(join(from, "README.md"), "notes");
    await Deno.writeTextFile(join(from, ".DS_Store"), "");

    expect(await copyFonts(from, to)).toEqual([
      "Lilex-Latin.woff2",
      "Lilex-OFL.txt",
      "Soehne-Buch.woff2",
    ]);
    expect(await Deno.readTextFile(join(to, "Soehne-Buch.woff2"))).toBe(
      "woff2",
    );
  });

  it("copies nothing from an empty folder", async () => {
    expect(await copyFonts(from, to)).toEqual([]);
  });

  // fonts/subset/ does not exist in a fresh clone or on CI.
  it("copies nothing from a folder that does not exist", async () => {
    expect(await copyFonts(join(from, "missing"), to)).toEqual([]);
  });
});

describe("missingFonts", () => {
  const css = `@font-face{src:url("fonts/A.woff2")}` +
    `@font-face{src:url(fonts/B.woff2) format("woff2")}`;

  it("lists the stylesheet's font files that were not shipped", () => {
    expect(fontUrls(css)).toEqual(["A.woff2", "B.woff2"]);
    expect(missingFonts(css, ["A.woff2", "A-OFL.txt"])).toEqual(["B.woff2"]);
  });

  it("is empty when everything was shipped", () => {
    expect(missingFonts(css, ["A.woff2", "B.woff2"])).toEqual([]);
  });
});

describe("the stylesheet's fonts", () => {
  const urls = fontUrls(CSS);

  it("are referenced by their served names", () => {
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(servedFontName(url)).toBe(url);
  });

  // Exactly what `deno task fonts` produces, so a desktop release that ran
  // it has every face, and nothing is asked for that it does not make.
  it("are Lilex plus the Söhne faces scripts/fonts.ts makes", () => {
    expect(urls).toEqual(
      ["Lilex-Latin.woff2", ...Object.values(SOEHNE_FACES)].sort(),
    );
  });

  // Söhne is licensed and kept out of the repository, so only Lilex has to
  // be here.
  it("include Lilex, with the licence the OFL requires to ship with it", () => {
    for (const file of ["Lilex-Latin.woff2", "Lilex-OFL.txt"]) {
      expect(Deno.statSync(join(FONTS, file)).isFile).toBe(true);
    }
  });
});
