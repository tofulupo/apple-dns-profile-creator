import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  compareConfigs,
  listDetail,
  matchDomainsDetail,
  resolverDetail,
  resolverSlots,
  shortHash,
} from "../../src/lib/compare.ts";
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

describe("listDetail", () => {
  it("names an entry that only one side has", () => {
    expect(listDetail([], ["Home-5G"])).toBe("Home-5G only in B");
    expect(listDetail(["Wi-Fi", "Cellular"], ["Wi-Fi"])).toBe(
      "Cellular only in A",
    );
  });

  it("names up to two entries per side and counts more", () => {
    expect(listDetail(
      ["foo", "bar"],
      ["Corporate-Guest", "Lab-Internal", "Lobby", "foo"],
    )).toBe("bar only in A · 3 only in B");
  });

  it("tells a different order from different entries", () => {
    expect(listDetail(["a.lan", "b.lan"], ["b.lan", "a.lan"])).toBe(
      "Same entries, different order",
    );
  });

  it("has nothing to say about equal lists", () => {
    expect(listDetail(["a.lan"], ["a.lan"])).toBeUndefined();
    expect(listDetail([], [])).toBeUndefined();
  });
});

describe("matchDomainsDetail", () => {
  it("reads an empty list as all domains", () => {
    expect(matchDomainsDetail(["*.corp.example"], [])).toBe(
      "B is used for all domains",
    );
    expect(matchDomainsDetail([], ["*.corp.example"])).toBe(
      "A is used for all domains",
    );
  });
});

describe("resolverSlots", () => {
  it("pairs the addresses by family and position, IPv4 first", () => {
    expect(resolverSlots(
      ["2001:db8::1", "192.0.2.1", "192.0.2.2"],
      ["198.51.100.1", "2001:db8::1"],
    )).toEqual([
      { label: "IPv4 1", a: "192.0.2.1", b: "198.51.100.1" },
      { label: "IPv4 2", a: "192.0.2.2", b: undefined },
      { label: "IPv6 1", a: "2001:db8::1", b: "2001:db8::1" },
    ]);
  });
});

describe("resolverDetail", () => {
  it("counts the addresses that differ", () => {
    expect(resolverDetail(
      ["192.0.2.1", "2001:db8::1"],
      ["198.51.100.1", "2001:db8::1"],
    )).toBe("1 of 2 addresses differ");
  });

  it("tells a different order from different addresses", () => {
    expect(resolverDetail(
      ["192.0.2.1", "2001:db8::1"],
      ["2001:db8::1", "192.0.2.1"],
    )).toBe("Same addresses, different order");
  });
});

describe("shortHash", () => {
  it("is the first 8 characters of the SHA-256", () => {
    const sha256 =
      "8a42f9e1c0d3b2a4958677a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6";
    expect(shortHash(sha256)).toBe("8a42f9e1");
  });
});
