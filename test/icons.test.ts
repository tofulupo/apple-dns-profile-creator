/**
 * Tests for inlining the stylesheet's icons, which keeps them from
 * flickering on every page change.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join, resolve } from "@std/path";

import { inlineIcons, svgDataUri } from "../scripts/build.ts";

const here = import.meta.dirname;
if (here === undefined) throw new Error("Test must be loaded from a file URL");
const ROOT = resolve(here, "..");

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path d="M1 1H23" stroke="#000" />
</svg>
`;

describe("svgDataUri", () => {
  it("compacts the SVG and escapes only what would break the URI", () => {
    expect(svgDataUri(SVG)).toBe(
      `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' ` +
        `viewBox='0 0 24 24'%3E%3Cpath d='M1 1H23' stroke='%23000' /%3E` +
        `%3C/svg%3E")`,
    );
  });

  it("refuses single quotes rather than produce a broken URI", () => {
    expect(() => svgDataUri(`<svg><text>it's</text></svg>`)).toThrow();
  });
});

describe("inlineIcons", () => {
  const read = (file: string) =>
    file === "icons/a.svg"
      ? Promise.resolve(SVG)
      : Promise.reject(new Error(`unexpected ${file}`));

  it("replaces quoted and unquoted icon references, reading each once", async () => {
    let reads = 0;
    const css = await inlineIcons(
      `.a{--icon:url(icons/a.svg)}.b{--icon:url("icons/a.svg")}`,
      (file) => {
        reads++;
        return read(file);
      },
    );
    expect(css).toBe(
      `.a{--icon:${svgDataUri(SVG)}}.b{--icon:${svgDataUri(SVG)}}`,
    );
    expect(reads).toBe(1);
  });

  it("leaves other URLs alone", async () => {
    const css = `.a{background:url(images/photo.png)}`;
    expect(await inlineIcons(css, read)).toBe(css);
  });

  it("inlines every icon the stylesheet uses", async () => {
    const source = await Deno.readTextFile(join(ROOT, "css", "app.css"));
    const css = await inlineIcons(
      source,
      (file) => Deno.readTextFile(join(ROOT, "public", file)),
    );
    expect(source).toContain("icons/");
    expect(css).not.toMatch(/url\(\s*["']?icons\//);
  });
});
