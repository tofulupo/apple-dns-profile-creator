import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { TARGETS } from "../../scripts/desktop_release.ts";
import { read, rustDependencies } from "../helpers/scan.ts";

/** The `"RUSTSEC-…", # crate` lines in .cargo/audit.toml. */
function ignored(): { id: string; crate: string }[] {
  const text = read(".cargo/audit.toml");
  const entries = [
    ...text.matchAll(/^\s*"(RUSTSEC-\d{4}-\d{4})",\s*#\s*([\w-]+)\s*$/gm),
  ].map((match) => ({ id: match[1]!, crate: match[2]! }));
  const ids = [...text.matchAll(/"(RUSTSEC-\d{4}-\d{4})"/g)].map((m) => m[1]);
  expect(ids).toEqual(entries.map((entry) => entry.id));
  return entries;
}

describe("advisories cargo audit ignores", () => {
  it("each name the crate they are about", () => {
    expect(ignored().length).toBeGreaterThan(0);
  });

  for (const { rust: target } of TARGETS) {
    it(`concern no crate built into the app for ${target}`, () => {
      const built = rustDependencies(target);
      expect(
        ignored().filter(({ crate }) => built.includes(crate))
          .map(({ id, crate }) => `${id} (${crate})`),
      ).toEqual([]);
    });
  }
});
