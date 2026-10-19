import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join } from "@std/path";

import {
  BERKELEY_MONO,
  copyWebFonts,
  isWoff2,
  WEB_FONTS,
} from "../scripts/web_fonts.ts";

describe("isWoff2", () => {
  it("knows a WOFF2 file from an error page", () => {
    expect(isWoff2(new TextEncoder().encode("wOF2\0\x01"))).toBe(true);
    expect(isWoff2(new TextEncoder().encode("<?xml version"))).toBe(false);
  });
});

describe("the website's fonts", () => {
  it("are Söhne's three weights and Berkeley Mono", () => {
    expect([...WEB_FONTS].sort()).toEqual([
      BERKELEY_MONO,
      "Soehne-Buch.woff2",
      "Soehne-Halbfett.woff2",
      "Soehne-Kraeftig.woff2",
    ]);
  });
});

describe("copyWebFonts", () => {
  let from: string;
  let to: string;

  beforeEach(async () => {
    const root = await Deno.makeTempDir({ prefix: "dns-fonts-local-" });
    from = join(root, "web");
    to = join(root, "dist", "fonts");
    await Deno.mkdir(from);
  });

  afterEach(async () => {
    await Deno.remove(join(from, ".."), { recursive: true });
  });

  it("copies every web font from the folder into the build", async () => {
    for (const name of WEB_FONTS) {
      await Deno.writeTextFile(join(from, name), `wOF2 ${name}`);
    }
    expect(await copyWebFonts(from, WEB_FONTS, to)).toEqual(
      [...WEB_FONTS].sort(),
    );
    expect(await Deno.readTextFile(join(to, BERKELEY_MONO))).toBe(
      `wOF2 ${BERKELEY_MONO}`,
    );
  });

  it("fails the build and copies nothing when one is missing", async () => {
    await Deno.writeTextFile(join(from, BERKELEY_MONO), "wOF2 font");
    await expect(copyWebFonts(from, WEB_FONTS, to)).rejects.toThrow(
      "is missing",
    );
    await expect(Deno.stat(to)).rejects.toThrow();
  });

  it("fails the build when a file is not a font", async () => {
    await Deno.writeTextFile(join(from, BERKELEY_MONO), "<html>");
    await expect(copyWebFonts(from, [BERKELEY_MONO], to)).rejects.toThrow(
      "not a WOFF2",
    );
  });
});

describe("the website build", () => {
  it("reaches no network and reads no secret", async () => {
    const { tasks } = JSON.parse(
      await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
    ) as { tasks: Record<string, string> };
    expect(tasks["build"]).not.toMatch(/--allow-net|-A\b|--allow-all/);
    expect(tasks["build"]).not.toMatch(/R2_|INDEXNOW_KEY/);
  });
});
