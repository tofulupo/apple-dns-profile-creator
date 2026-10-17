import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { PAGE_ENTRYPOINTS } from "../../scripts/build.ts";
import { TARGETS } from "../../scripts/desktop_release.ts";
import {
  isolationDir,
  pageCode,
  repoCodeFiles,
  rustCode,
  rustDependencies,
} from "../helpers/scan.ts";

/** Folders and files that never run in a page or in the app. */
const NEVER_SHIPPED = [
  /^test\//,
  /^scripts\//,
  /^\.github\//,
  /^pages\/pages\.ts$/,
  /^src-tauri\/build\.rs$/,
  /^src-tauri\/examples\//,
];

describe("the guards see all the code that ships", () => {
  it("scans every script the pages run, and what each imports", () => {
    const scanned = pageCode();
    for (const entrypoint of PAGE_ENTRYPOINTS) {
      expect(scanned).toContain(entrypoint);
    }
    expect(scanned).toContain(`${isolationDir()}/hook.js`);
    expect(scanned).toContain("src/lib/plist.ts");
  });

  it("knows where every code file in the repo belongs", () => {
    const scanned = new Set([...pageCode(), ...rustCode()]);
    const unknown = repoCodeFiles().filter((path) =>
      !scanned.has(path) && !NEVER_SHIPPED.some((place) => place.test(path))
    );
    expect(unknown).toEqual([]);
  });

  it("scans the app's Rust code", () => {
    expect(rustCode()).toContain("src-tauri/src/lib.rs");
  });

  for (const { rust: target } of TARGETS) {
    it(`reads the Rust dependencies built for ${target}`, () => {
      expect(rustDependencies(target)).toEqual(
        expect.arrayContaining(["tauri", "serde_json"]),
      );
    });
  }
});
