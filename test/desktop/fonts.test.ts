import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join, resolve } from "@std/path";

import {
  copyFonts,
  fontUrls,
  missingFonts,
  servedFontName,
  withoutMissingFonts,
} from "../../scripts/build.ts";
import { SOEHNE_FACES } from "../../scripts/fonts.ts";
import { BERKELEY_MONO } from "../../scripts/web_fonts.ts";

const here = import.meta.dirname;
if (here === undefined) throw new Error("Must be loaded from a file URL");
const ROOT = resolve(here, "..", "..");
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

describe("withoutMissingFonts", () => {
  const css =
    `@font-face {\n  font-family: "A";\n  src: url("fonts/A.woff2");\n}\n` +
    `@font-face {\n  font-family: "B";\n  src: url("fonts/B.woff2");\n}\n` +
    `body {\n  font-family: "A", "B", sans-serif;\n}\n`;

  it("drops the rules for fonts the build does not have", () => {
    expect(withoutMissingFonts(css, ["A.woff2"])).toBe(
      `@font-face {\n  font-family: "A";\n  src: url("fonts/A.woff2");\n}\n` +
        `body {\n  font-family: "A", "B", sans-serif;\n}\n`,
    );
  });

  it("keeps everything when every font shipped", () => {
    expect(withoutMissingFonts(css, ["A.woff2", "B.woff2"])).toBe(css);
  });
});

describe("the stylesheet's fonts", () => {
  const urls = fontUrls(CSS);

  it("are referenced by their served names", () => {
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(servedFontName(url)).toBe(url);
  });

  it("are Lilex, Geist Pixel, Berkeley Mono and the Söhne faces scripts/fonts.ts makes", () => {
    expect(urls).toEqual(
      [
        "GeistPixel-Square.woff2",
        "Lilex-Latin.woff2",
        BERKELEY_MONO,
        ...Object.values(SOEHNE_FACES),
      ].sort(),
    );
  });

  // Covered by Geist's licence, from the same package.
  it("include Geist Pixel", () => {
    expect(Deno.statSync(join(FONTS, "GeistPixel-Square.woff2")).isFile)
      .toBe(true);
  });

  // Söhne and Berkeley Mono are licensed and kept out of the repository.
  // Geist's licence stays for Geist Pixel.
  it("include Lilex, with the licences the OFL requires to ship", () => {
    for (
      const file of ["Lilex-Latin.woff2", "Lilex-OFL.txt", "Geist-OFL.txt"]
    ) {
      expect(Deno.statSync(join(FONTS, file)).isFile).toBe(true);
    }
  });

  it("leave no licensed font in the repository", () => {
    const { stdout } = new Deno.Command("git", {
      args: ["ls-files", "fonts"],
      cwd: ROOT,
      stdout: "piped",
    }).outputSync();
    const committed = new TextDecoder().decode(stdout).trim().split("\n")
      .sort();
    expect(committed).toEqual([
      "fonts/Geist-OFL.txt",
      "fonts/GeistPixel-Square.woff2",
      "fonts/Lilex-Latin.woff2",
      "fonts/Lilex-OFL.txt",
    ]);
  });

  // Berkeley Mono is licensed for the website only.
  it("set the text in Söhne, the website's monospace in Berkeley Mono and the app's in Lilex", () => {
    expect(CSS).toMatch(/:root \{[^}]*--font: "Söhne",/);
    expect(CSS).toMatch(/:root \{[^}]*--font-mono: "Berkeley Mono",/);
    expect(CSS).toMatch(
      /:root\[data-app="desktop"\] \{\s*--font-mono: "Lilex",/,
    );
  });
});
