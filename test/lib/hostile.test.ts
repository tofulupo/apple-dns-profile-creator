import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { importProfileXml } from "../../src/lib/import.ts";

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';

function profileNamed(name: string, doctype = ""): string {
  return HEAD + doctype + '<plist version="1.0"><dict>' +
    "<key>PayloadContent</key><array><dict>" +
    "<key>PayloadType</key><string>com.apple.dnsSettings.managed</string>" +
    `<key>PayloadDisplayName</key><string>${name}</string>` +
    "<key>DNSSettings</key><dict>" +
    "<key>DNSProtocol</key><string>HTTPS</string>" +
    "<key>ServerURL</key><string>https://dns.example.com/dns-query</string>" +
    "</dict></dict></array></dict></plist>";
}

describe("hostile profiles", () => {
  it("never expand an entity declared in the DOCTYPE", () => {
    const doctype = "<!DOCTYPE plist [" +
      '<!ENTITY a "AAAAAAAAAA">' +
      '<!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">' +
      '<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">' +
      "]>";
    const result = importProfileXml(profileNamed("&c;", doctype));
    expect(result.configs.map((config) => config.name)).toEqual(["&c;"]);
  });

  it("end in an error when dictionaries nest thousands of levels deep", () => {
    const depth = 100_000;
    const xml = HEAD + '<plist version="1.0">' +
      "<dict><key>k</key>".repeat(depth) + "<string>x</string>" +
      "</dict>".repeat(depth) + "</plist>";
    expect(() => importProfileXml(xml)).toThrow();
  });

  it("refuse a binary property list", () => {
    expect(() => importProfileXml("bplist00\u0000\u0001\u0002")).toThrow(
      "No property list found",
    );
  });

  it("refuse an empty file", () => {
    expect(() => importProfileXml("")).toThrow("No property list found");
  });
});
