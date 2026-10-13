import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { greaterOrEqual, parse } from "@std/semver";

import { read } from "../helpers/scan.ts";

/**
 * The first versions with the fixes from Tauri's security advisories: the
 * channel fetch access check (tauri), allowDowngrades from the page
 * (updater, GHSA-rjc6-5hfg-grp9) and the open scope (shell).
 */
const MINIMUM: Readonly<Record<string, string>> = {
  "tauri": "2.11.6",
  "tauri-plugin-updater": "2.12.0",
  "tauri-plugin-shell": "2.2.1",
};

/** Each `[[package]]` in a Cargo.lock, by name, with every version locked. */
function lockedVersions(lock: string): Map<string, string[]> {
  const versions = new Map<string, string[]>();
  for (
    const [, name, version] of lock.matchAll(
      /^name = "([^"]+)"\nversion = "([^"]+)"$/gm,
    )
  ) {
    versions.set(name!, [...(versions.get(name!) ?? []), version!]);
  }
  return versions;
}

function belowMinimum(lock: string): string[] {
  const versions = lockedVersions(lock);
  return Object.entries(MINIMUM).flatMap(([name, minimum]) =>
    (versions.get(name) ?? [])
      .filter((version) => !greaterOrEqual(parse(version), parse(minimum)))
      .map((version) => `${name} ${version}, needs ${minimum}`)
  );
}

describe("the app is built on Tauri with its security fixes", () => {
  it("locks no Tauri crate below the version with its fix", () => {
    const lock = read("src-tauri/Cargo.lock");
    expect(lockedVersions(lock).get("tauri")?.length).toBe(1);
    expect(belowMinimum(lock)).toEqual([]);
  });

  it("would notice an older Tauri or plugin", () => {
    const lock = [
      'name = "tauri"\nversion = "2.11.5"',
      'name = "tauri-plugin-updater"\nversion = "2.11.9"',
      'name = "tauri-plugin-shell"\nversion = "2.2.1"',
    ].join("\n\n");
    expect(belowMinimum(lock)).toEqual([
      "tauri 2.11.5, needs 2.11.6",
      "tauri-plugin-updater 2.11.9, needs 2.12.0",
    ]);
  });
});
