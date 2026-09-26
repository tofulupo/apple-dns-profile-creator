/**
 * Guards the desktop app icon source: every layer's image exists, both the
 * background and the glyph have a dark look, the glyph stays visible in the
 * Clear and Tinted looks, and the fallback PNG is there.
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
  readonly value?: unknown;
}

interface IconDocument {
  readonly "fill-specializations"?: readonly Specialization[];
  readonly groups: readonly {
    readonly layers: readonly {
      readonly "image-name": string;
      readonly "fill-specializations"?: readonly Specialization[];
      readonly "glass-specializations"?: readonly Specialization[];
    }[];
  }[];
}

const document = JSON.parse(
  Deno.readTextFileSync(join(ICON, "icon.json")),
) as IconDocument;
const layers = document.groups.flatMap((group) => group.layers);

function has(
  specializations: readonly Specialization[] | undefined,
  appearance: string,
): boolean {
  return specializations?.some((entry) => entry.appearance === appearance) ===
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
    expect(has(document["fill-specializations"], "dark")).toBe(true);
    expect(layers.every((layer) => has(layer["fill-specializations"], "dark")))
      .toBe(true);
  });

  // Clear and Tinted draw every layer as tinted glass. A flat layer with a
  // colour meant for Default blends into the background there, so each layer
  // needs glass and its own colour for the "tinted" appearance, which covers
  // both looks.
  it("stays visible in the Clear and Tinted looks", () => {
    for (const layer of layers) {
      const glass = layer["glass-specializations"]?.find((entry) =>
        entry.appearance === "tinted"
      );
      expect({ layer: layer["image-name"], glass: glass?.value }).toEqual({
        layer: layer["image-name"],
        glass: true,
      });
      expect(has(layer["fill-specializations"], "tinted")).toBe(true);
    }
  });

  it("has the fallback PNG deno desktop builds the .icns from", () => {
    expect(Deno.statSync(join(ROOT, "desktop", "AppIcon.png")).isFile).toBe(
      true,
    );
  });
});
