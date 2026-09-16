/**
 * Byte-for-byte output lock. Any diff here is a change to what users install,
 * and has to be deliberate.
 *
 * The fixture-derived goldens were produced before `DNSSettings` and
 * `OnDemandRules` were split out of `profile.ts`, so they lock the refactor
 * against the original output. `full-surface` covers the keys no upstream
 * profile uses, and locks forward from the commit that added it.
 */
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
