/**
 * Guards the desktop app icon source: every layer's image exists, both the
 * background and the glyph have a dark look, and the fallback PNG is there.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join, resolve } from "@std/path";

const here = import.meta.dirname;
if (here === undefined) throw new Error("Must be loaded from a file URL");
const ROOT = resolve(here, "..", "..");
const ICON = join(ROOT, "desktop", "AppIcon.icon");

interface Specialization {
  readonly appearance?: string;
}

interface IconDocument {
  readonly "fill-specializations"?: readonly Specialization[];
  readonly groups: readonly {
    readonly layers: readonly {
      readonly "image-name": string;
      readonly "fill-specializations"?: readonly Specialization[];
    }[];
  }[];
}

const document = JSON.parse(
  Deno.readTextFileSync(join(ICON, "icon.json")),
) as IconDocument;
const layers = document.groups.flatMap((group) => group.layers);

function hasDark(specializations: readonly Specialization[] | undefined) {
  return specializations?.some((entry) => entry.appearance === "dark") ===
    true;
}

describe("desktop/AppIcon.icon", () => {
  it("has at least one layer", () => {
    expect(layers.length).toBeGreaterThan(0);
  });

  for (const layer of layers) {
    it(`finds the image of layer ${layer["image-name"]}`, () => {
      expect(Deno.statSync(join(ICON, "Assets", layer["image-name"])).isFile)
        .toBe(true);
    });
  }

  it("inverts in dark mode: background and glyph both change", () => {
    expect(hasDark(document["fill-specializations"])).toBe(true);
    expect(layers.every((layer) => hasDark(layer["fill-specializations"])))
      .toBe(true);
  });

  it("has the fallback PNG deno desktop builds the .icns from", () => {
    expect(Deno.statSync(join(ROOT, "desktop", "AppIcon.png")).isFile).toBe(
      true,
    );
  });
});
