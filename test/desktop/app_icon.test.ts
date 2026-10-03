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
      readonly "opacity-specializations"?: readonly Specialization[];
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

function opacity(
  layer: (typeof layers)[number],
  appearance: string | undefined,
): unknown {
  return layer["opacity-specializations"]?.find((entry) =>
    entry.appearance === appearance
  )?.value;
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

  it("shows the light mascot in light mode and the dark one in dark mode", () => {
    expect(has(document["fill-specializations"], "dark")).toBe(true);
    const shown = (appearance: string | undefined) =>
      layers.filter((layer) => opacity(layer, appearance) === 1)
        .map((layer) => layer["image-name"]);
    expect(shown(undefined)).toEqual(["mascot-light.svg"]);
    expect(shown("dark")).toEqual(["mascot-dark.svg"]);
  });

  it("has the fallback PNG the app's older icon files come from", () => {
    expect(Deno.statSync(join(ROOT, "desktop", "AppIcon.png")).isFile).toBe(
      true,
    );
  });
});
