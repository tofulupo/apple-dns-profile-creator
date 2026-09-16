/**
 * Specification tests for the import direction (`src/lib/import.ts`).
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  extractPlistXml,
  parseProfile,
  parseProfileXml,
  ProfileImportError,
} from "../../src/lib/import.ts";
import { parsePlist } from "../../src/lib/plist.ts";
import {
  extractedFixtures,
  fixture,
  hasSignedFixtures,
  plainXmlFixtures,
  signedFixtures,
} from "../helpers/fixtures.ts";

function importFixture(name: string) {
  return parseProfileXml(fixture(name).text);
}

describe("the whole corpus is readable", () => {
  const corpus = [...plainXmlFixtures(), ...extractedFixtures()];

  for (const f of corpus) {
    it(`${f.name} imports to at least one configuration`, () => {
      const configs = parseProfileXml(f.text);
      expect(configs.length).toBeGreaterThan(0);
      for (const c of configs) {
        expect(["HTTPS", "TLS"]).toContain(c.protocol);
        expect(c.serverUrl).not.toBe("");
      }
    });
  }
});

describe("DoT profile (cloudflare-default-tls)", () => {
  it("reads the protocol and server name", () => {
    const [c] = importFixture("cloudflare-default-tls");
    expect(c?.protocol).toBe("TLS");
    expect(c?.serverUrl).toBe("one.one.one.one");
  });

  it("reads every resolver address, in order", () => {
    const [c] = importFixture("cloudflare-default-tls");
    expect(c?.serverAddresses).toEqual([
      "2606:4700:4700::1111",
      "2606:4700:4700::1001",
      "1.1.1.1",
      "1.0.0.1",
    ]);
  });

  it("reads ProhibitDisablement", () => {
    const [c] = importFixture("cloudflare-default-tls");
    expect(c?.prohibitDisablement).toBe(false);
  });
});

describe("DoH profile (quad9-ECS-https)", () => {
  it("reads the protocol and server URL", () => {
    const [c] = importFixture("quad9-ECS-https");
    expect(c?.protocol).toBe("HTTPS");
    expect(c?.serverUrl).toBe("https://dns11.quad9.net/dns-query");
  });

  it("does not confuse ServerURL with ServerName", () => {
    const [c] = importFixture("quad9-ECS-https");
    expect(c?.serverUrl.startsWith("https://")).toBe(true);
  });
});

describe("on-demand rules (template-on-demand-default-https)", () => {
  it("recovers excluded SSIDs", () => {
    const [c] = importFixture("template-on-demand-default-https");
    expect(c?.excludedWifi).toEqual([
      "TRUSTED_NETWORK_1",
      "TRUSTED_NETWORK_2",
      "TRUSTED_NETWORK_3",
    ]);
  });

  it("finds no excluded domains", () => {
    const [c] = importFixture("template-on-demand-default-https");
    expect(c?.excludedDomains).toEqual([]);
  });

  it("defaults every interface to enabled when the profile says nothing", () => {
    const [c] = importFixture("template-on-demand-default-https");
    expect(c?.useWifi).toBe(true);
    expect(c?.useCellular).toBe(true);
    expect(c?.useEthernet).toBe(true);
  });

  it("treats an unconditional Disconnect as the catch-all", () => {
    const [c] = parseProfile(
      parsePlist(`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>PayloadContent</key><array><dict>
    <key>DNSSettings</key><dict>
      <key>DNSProtocol</key><string>TLS</string>
      <key>ServerName</key><string>dot.example.com</string>
    </dict>
    <key>OnDemandRules</key><array>
      <dict><key>Action</key><string>Connect</string>
            <key>InterfaceTypeMatch</key><string>WiFi</string></dict>
      <dict><key>Action</key><string>Disconnect</string></dict>
    </array>
  </dict></array>
</dict></plist>`),
    );
    expect(c?.useWifi).toBe(true);
    expect(c?.useCellular).toBe(false);
    expect(c?.useEthernet).toBe(false);
  });
});

describe("interface rules are read when present", () => {
  it("maps Connect and Disconnect per interface", () => {
    const xml = parsePlist(`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>PayloadContent</key><array><dict>
    <key>DNSSettings</key><dict>
      <key>DNSProtocol</key><string>TLS</string>
      <key>ServerName</key><string>dot.example.com</string>
    </dict>
    <key>OnDemandRules</key><array>
      <dict><key>Action</key><string>Connect</string>
            <key>InterfaceTypeMatch</key><string>WiFi</string></dict>
      <dict><key>Action</key><string>Disconnect</string>
            <key>InterfaceTypeMatch</key><string>Cellular</string></dict>
      <dict><key>Action</key><string>Connect</string>
            <key>InterfaceTypeMatch</key><string>Ethernet</string></dict>
    </array>
  </dict></array>
</dict></plist>`);
    const [c] = parseProfile(xml);
    expect(c?.useWifi).toBe(true);
    expect(c?.useCellular).toBe(false);
    expect(c?.useEthernet).toBe(true);
  });
});

describe("malformed input", () => {
  it("rejects an unrecognised DNSProtocol instead of assuming DoT", () => {
    const xml = parsePlist(`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>PayloadContent</key><array><dict>
    <key>DNSSettings</key><dict>
      <key>DNSProtocol</key><string>CARRIER_PIGEON</string>
      <key>ServerName</key><string>dot.example.com</string>
    </dict>
  </dict></array>
</dict></plist>`);
    expect(() => parseProfile(xml)).toThrow(ProfileImportError);
  });

  it("rejects a profile with no PayloadContent", () => {
    const xml = parsePlist(
      '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>PayloadType</key><string>Configuration</string></dict></plist>',
    );
    expect(() => parseProfile(xml)).toThrow(ProfileImportError);
  });

  it("rejects a root that is not a dictionary", () => {
    const xml = parsePlist(
      '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><array/></plist>',
    );
    expect(() => parseProfile(xml)).toThrow(ProfileImportError);
  });
});

describe("extractPlistXml", () => {
  it("passes a plain XML profile through", () => {
    const { text } = fixture("cloudflare-default-tls");
    const extracted = extractPlistXml(text);
    expect(extracted.startsWith("<!DOCTYPE plist")).toBe(true);
    expect(extracted.trimEnd().endsWith("</plist>")).toBe(true);
  });

  it("reports a clear error for a file that is not a profile", () => {
    expect(() => extractPlistXml("just some text")).toThrow(ProfileImportError);
  });

  it({
    name: "recovers the plist from a signed DER container",
    ignore: !hasSignedFixtures(),
    fn: () => {
      for (const f of signedFixtures()) {
        expect(parseProfileXml(f.text).length).toBeGreaterThan(0);
      }
    },
  });
});
