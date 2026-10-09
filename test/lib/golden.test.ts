import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join } from "@std/path";

import { parseProfileXml } from "../../src/lib/import.ts";
import { buildProfileXml } from "../../src/lib/profile.ts";
import { fullSurfaceConfigs } from "../helpers/configs.ts";
import { plainXmlFixtures } from "../helpers/fixtures.ts";
import { stubUuid } from "../helpers/uuid.ts";

const here = import.meta.dirname;
if (here === undefined) {
  throw new Error("Golden test must be loaded from a file URL");
}
const GOLDEN_DIR = join(here, "..", "golden");

describe("generated profiles are unchanged", () => {
  for (const source of plainXmlFixtures()) {
    it(`reproduces ${source.name}`, () => {
      const xml = buildProfileXml(
        parseProfileXml(source.text),
        { systemScope: false, identifierPrefix: "local.encrypted-dns." },
        stubUuid(),
      );
      const golden = Deno.readTextFileSync(
        join(GOLDEN_DIR, `${source.name}.mobileconfig`),
      );
      expect(xml).toBe(golden);
    });
  }

  // The app's Rust check is tested against this one, so it must cover every
  // key the declaration format can hold.
  it("reproduces the declaration fixture of the app's profile check", () => {
    const xml = buildProfileXml(
      fullSurfaceConfigs(),
      {
        systemScope: true,
        identifierPrefix: "local.encrypted-dns.",
        format: "declarations",
      },
      stubUuid(),
    );
    const fixture = Deno.readTextFileSync(
      join(
        here,
        "..",
        "..",
        "src-tauri",
        "tests",
        "fixtures",
        "declarations.mobileconfig",
      ),
    );
    expect(xml).toBe(fixture);
  });

  it("reproduces full-surface", () => {
    const xml = buildProfileXml(
      fullSurfaceConfigs(),
      { systemScope: true, identifierPrefix: "local.encrypted-dns." },
      stubUuid(),
    );
    const golden = Deno.readTextFileSync(
      join(GOLDEN_DIR, "full-surface.mobileconfig"),
    );
    expect(xml).toBe(golden);
  });
});
