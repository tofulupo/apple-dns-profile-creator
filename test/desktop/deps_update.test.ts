/**
 * `deno task deps:update`: reading Cargo's plan, finding crates in the
 * crates.io index, and holding back versions younger than a day.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  type CargoUpdate,
  type IndexEntry,
  indexPath,
  MIN_AGE_MS,
  parseDryRun,
  pickVersion,
} from "../../scripts/deps_update.ts";

describe("parseDryRun", () => {
  it("lists the crates Cargo would update, and nothing else", () => {
    const output = [
      "    Updating crates.io index",
      "     Locking 3 packages to latest Rust 1.98.1 compatible versions",
      "    Updating tauri v2.12.0 -> v2.12.1",
      "    Removing windows v0.61.3",
      "    Updating tauri-plugin-opener v2.6.0 -> v2.7.0",
      "note: pass `--verbose` to see 5 unchanged dependencies behind latest",
      "warning: not updating lockfile due to dry run",
    ].join("\n");
    expect(parseDryRun(output)).toEqual([
      { name: "tauri", from: "2.12.0", to: "2.12.1" },
      { name: "tauri-plugin-opener", from: "2.6.0", to: "2.7.0" },
    ]);
  });
});

describe("indexPath", () => {
  it("follows the sparse index's layout by name length", () => {
    expect(indexPath("a")).toBe("1/a");
    expect(indexPath("cc")).toBe("2/cc");
    expect(indexPath("syn")).toBe("3/s/syn");
    expect(indexPath("tauri")).toBe("ta/ur/tauri");
    expect(indexPath("Serde")).toBe("se/rd/serde");
  });
});

describe("pickVersion", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const daysAgo = (days: number) =>
    new Date(now - days * MIN_AGE_MS).toISOString();
  const update: CargoUpdate = { name: "tauri", from: "2.12.0", to: "2.12.3" };

  function entries(
    ...list: [vers: string, pubtime?: string, yanked?: boolean][]
  ): IndexEntry[] {
    return list.map(([vers, pubtime, yanked = false]) =>
      pubtime === undefined ? { vers, yanked } : { vers, yanked, pubtime }
    );
  }

  it("takes Cargo's choice once it is a day old", () => {
    expect(pickVersion(update, entries(["2.12.3", daysAgo(1.5)]), now))
      .toBe("2.12.3");
  });

  it("falls back to the newest version that is a day old", () => {
    expect(
      pickVersion(
        update,
        entries(
          ["2.12.1", daysAgo(5)],
          ["2.12.2", daysAgo(2)],
          ["2.12.3", daysAgo(0.5)],
        ),
        now,
      ),
    ).toBe("2.12.2");
  });

  it("holds the crate back when every newer version is too young", () => {
    expect(
      pickVersion(
        update,
        entries(["2.12.0", daysAgo(9)], ["2.12.3", daysAgo(0.9)]),
        now,
      ),
    ).toBeUndefined();
  });

  it("never picks a yanked version, a pre-release or one past Cargo's", () => {
    expect(
      pickVersion(
        update,
        entries(
          ["2.12.1", daysAgo(4), true],
          ["2.12.2-beta.1", daysAgo(3)],
          ["2.13.0", daysAgo(3)],
          ["3.0.0-alpha.3", daysAgo(3)],
        ),
        now,
      ),
    ).toBeUndefined();
  });

  it("trusts versions the index has no publish time for", () => {
    expect(pickVersion(update, entries(["2.12.3"]), now)).toBe("2.12.3");
  });
});
