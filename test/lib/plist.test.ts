/**
 * Validates the replacement plist implementation - infrastructure, not
 * application behaviour.
 */
import { afterAll, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join } from "@std/path";

import {
  buildPlist,
  parsePlist,
  PlistParseError,
} from "../../src/lib/plist.ts";
import { buildProfile } from "../../src/lib/profile.ts";
import type { DnsConfig } from "../../src/lib/types.ts";
import { extractedFixtures, plainXmlFixtures } from "../helpers/fixtures.ts";

const scratch = Deno.makeTempDirSync({ prefix: "dns-mobileconfig-" });
afterAll(() => Deno.removeSync(scratch, { recursive: true }));

function plutilAvailable(): boolean {
  if (Deno.build.os !== "darwin") return false;
  try {
    return new Deno.Command("plutil", {
      args: ["-help"],
      stderr: "null",
      stdout: "null",
    })
      .outputSync().success;
  } catch {
    return false;
  }
}

/** Runs Apple's property list linter over a string. */
function plutilLint(xml: string, name: string): void {
  const path = join(scratch, `${name}.plist`);
  Deno.writeTextFileSync(path, xml);
  const result = new Deno.Command("plutil", {
    args: ["-lint", path],
    stdout: "piped",
    stderr: "piped",
  }).outputSync();

  if (!result.success) {
    const output = new TextDecoder().decode(result.stdout) +
      new TextDecoder().decode(result.stderr);
    throw new Error(`plutil rejected ${name}: ${output.trim()}`);
  }
}

describe("buildPlist", () => {
  it("emits the Apple prolog and a plist root", () => {
    const xml = buildPlist({ Key: "value" });
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"',
    );
    expect(xml).toContain('<plist version="1.0">');
    expect(xml.trimEnd().endsWith("</plist>")).toBe(true);
  });

  it("preserves dictionary key insertion order", () => {
    const xml = buildPlist({ zebra: "z", apple: "a", mango: "m" });
    const keys = [...xml.matchAll(/<key>(\w+)<\/key>/g)].map((m) => m[1]);
    expect(keys).toEqual(["zebra", "apple", "mango"]);
  });

  it("renders each scalar type with the right tag", () => {
    expect(buildPlist(true)).toContain("<true/>");
    expect(buildPlist(false)).toContain("<false/>");
    expect(buildPlist(1)).toContain("<integer>1</integer>");
    expect(buildPlist(1.5)).toContain("<real>1.5</real>");
    expect(buildPlist("hi")).toContain("<string>hi</string>");
  });

  it("self-closes empty containers, as plutil does", () => {
    expect(buildPlist([])).toContain("<array/>");
    expect(buildPlist({})).toContain("<dict/>");
  });

  it("escapes XML metacharacters in both values and keys", () => {
    const xml = buildPlist({ "a & b": '<tag> & "more"' });
    expect(xml).toContain("<key>a &amp; b</key>");
    expect(xml).toContain("&lt;tag&gt; &amp; ");
    expect(xml).not.toMatch(/<string><tag>/);
  });
});

describe("parsePlist", () => {
  it("rejects malformed XML", () => {
    expect(() => parsePlist("<plist><dict><key>x</dict></plist>")).toThrow(
      PlistParseError,
    );
  });

  it("rejects a non-plist root", () => {
    expect(() => parsePlist("<foo><dict/></foo>")).toThrow(PlistParseError);
  });

  it("rejects a dict whose keys and values are unbalanced", () => {
    expect(() =>
      parsePlist(
        '<plist version="1.0"><dict><key>a</key><string>1</string><key>b</key></dict></plist>',
      )
    ).toThrow(PlistParseError);
  });

  it("rejects an unsupported element", () => {
    expect(() => parsePlist('<plist version="1.0"><surprise/></plist>'))
      .toThrow(
        PlistParseError,
      );
  });
});

describe("round-trip fidelity", () => {
  it("survives a nested structure unchanged", () => {
    const value = {
      str: "text",
      yes: true,
      no: false,
      int: 42,
      real: 3.25,
      when: new Date("2021-03-04T05:06:07Z"),
      list: ["a", 1, false, { nested: "deep" }],
      empty: [],
      blank: "",
      dict: {},
    };
    expect(parsePlist(buildPlist(value))).toEqual(value);
  });

  const corpus = [...plainXmlFixtures(), ...extractedFixtures()];

  it("has a corpus to work with", () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  for (const f of corpus) {
    it(`${f.name} survives parse -> build -> parse`, () => {
      const once = parsePlist(f.text);
      const twice = parsePlist(buildPlist(once));
      expect(twice).toEqual(once);
    });
  }
});

if (plutilAvailable()) {
  describe("Apple accepts what we emit", () => {
    for (const f of [...plainXmlFixtures(), ...extractedFixtures()]) {
      it(`re-serialised ${f.name} passes plutil -lint`, () => {
        plutilLint(buildPlist(parsePlist(f.text)), `reserialised-${f.name}`);
      });
    }

    it("a freshly built profile passes plutil -lint", () => {
      let n = 0;
      const uuid = () =>
        `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

      const config: DnsConfig = {
        name: "Example & Co <test>",
        protocol: "TLS",
        serverUrl: "dot.example.com",
        serverAddresses: ["2001:db8::1", "192.0.2.1", "192.0.2.2"],
        excludedWifi: ["Home", "Office"],
        excludedDomains: ["example.com"],
        useWifi: true,
        useCellular: true,
        useEthernet: false,
        prohibitDisablement: true,
        allowFailover: true,
        supplementalMatchDomains: ["*.corp.example"],
      };

      const xml = buildPlist(
        buildProfile([config], { systemScope: true }, uuid),
      );
      plutilLint(xml, "generated-profile");
    });
  });
}
