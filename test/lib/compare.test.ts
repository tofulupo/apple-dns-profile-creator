import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { compareConfigs, shortHash } from "../../src/lib/compare.ts";
import { config } from "../helpers/configs.ts";

function differing(a = config(), b = config()): string[] {
  return compareConfigs(a, b)
    .filter((row) => row.differs)
    .map((row) => row.field);
}

describe("compareConfigs", () => {
  it("returns exactly the rows whose values differ", () => {
    expect(differing(
      config(),
      config({ serverUrl: "dot.example.net", useCellular: false }),
    )).toEqual(["serverUrl", "useCellular"]);
    expect(differing()).toEqual([]);
  });

  it("finds no differing settings between a legacy and a declarative copy", () => {
    expect(differing(
      config({ paradigm: "payload", source: { file: "a.mobileconfig" } }),
      config({
        paradigm: "declarations",
        source: { file: "a 2.mobileconfig" },
      }),
    )).toEqual([]);
  });

  it.ignore(
    "shows no difference in the raw text for key order and whitespace",
    () => {},
  );

  it.ignore(
    "copies as a Markdown table with one row per field and both values",
    () => {},
  );
});

describe("shortHash", () => {
  it("is the first 8 characters of the SHA-256", () => {
    const sha256 =
      "8a42f9e1c0d3b2a4958677a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6";
    expect(shortHash(sha256)).toBe("8a42f9e1");
  });
});
