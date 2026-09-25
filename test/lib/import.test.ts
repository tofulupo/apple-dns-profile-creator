/**
 * Specification tests for the import direction (`src/lib/import.ts`).
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  extractPlistXml,
  importProfile,
  importProfileXml,
  parseProfile,
  parseProfileXml,
  ProfileImportError,
} from "../../src/lib/import.ts";
import { buildProfile } from "../../src/lib/profile.ts";
import { config, fullSurfaceConfigs } from "../helpers/configs.ts";
import { stubUuid } from "../helpers/uuid.ts";
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

/** A plain XML profile whose PayloadContent holds `payloads`, verbatim. */
function profileXml(payloads: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>PayloadContent</key><array>${payloads}</array>
</dict></plist>`;
}

function dnsPayload(rules = ""): string {
  return `<dict>
    <key>DNSSettings</key><dict>
      <key>DNSProtocol</key><string>TLS</string>
      <key>ServerName</key><string>dot.example.com</string>
    </dict>
    <key>OnDemandRules</key><array>${rules}</array>
    <key>PayloadDisplayName</key><string>Example</string>
    <key>PayloadType</key><string>com.apple.dnsSettings.managed</string>
  </dict>`;
}

describe("SSID rules", () => {
  it("does not read a Connect limited to SSIDs as an exclusion", () => {
    const [c] = parseProfileXml(profileXml(dnsPayload(`
      <dict><key>Action</key><string>Connect</string>
            <key>SSIDMatch</key><array><string>Office</string></array></dict>
      <dict><key>Action</key><string>Disconnect</string></dict>`)));
    expect(c?.excludedWifi).toEqual([]);
  });

  it("reads a Disconnect on SSIDs as an exclusion", () => {
    const [c] = parseProfileXml(profileXml(dnsPayload(`
      <dict><key>Action</key><string>Disconnect</string>
            <key>SSIDMatch</key><array><string>Home</string></array></dict>`)));
    expect(c?.excludedWifi).toEqual(["Home"]);
  });

  it("does not let an SSID rule switch its whole interface", () => {
    const [c] = parseProfileXml(profileXml(dnsPayload(`
      <dict><key>Action</key><string>Disconnect</string>
            <key>InterfaceTypeMatch</key><string>WiFi</string>
            <key>SSIDMatch</key><array><string>Home</string></array></dict>
      <dict><key>Action</key><string>Connect</string></dict>`)));
    expect(c?.excludedWifi).toEqual(["Home"]);
    expect(c?.useWifi).toBe(true);
  });
});

describe("profiles mixing payload types", () => {
  const wifiPayload = `<dict>
    <key>PayloadType</key><string>com.apple.wifi.managed</string>
    <key>SSID_STR</key><string>Home</string>
  </dict>`;

  it("skips payloads that are not DNS settings", () => {
    const configs = parseProfileXml(
      profileXml(wifiPayload + dnsPayload() + wifiPayload),
    );
    expect(configs.map((c) => c.serverUrl)).toEqual(["dot.example.com"]);
  });

  it("yields nothing for a profile without a DNS payload", () => {
    expect(parseProfileXml(profileXml(wifiPayload))).toEqual([]);
  });

  it("still rejects a DNS payload with no DNSProtocol", () => {
    const broken = `<dict>
      <key>DNSSettings</key><dict/>
      <key>PayloadType</key><string>com.apple.dnsSettings.managed</string>
    </dict>`;
    expect(() => parseProfileXml(profileXml(broken))).toThrow(
      ProfileImportError,
    );
  });
});

describe("import warnings", () => {
  function warningsFor(rules: string): string[] {
    return importProfileXml(profileXml(dnsPayload(rules))).warnings;
  }

  it("are empty for every profile this tool builds", () => {
    const configs = [...fullSurfaceConfigs(), config()];
    const profile = buildProfile(configs, { systemScope: true }, stubUuid());
    expect(importProfile(profile).warnings).toEqual([]);
  });

  it("are empty for every upstream plain XML fixture", () => {
    for (const f of plainXmlFixtures()) {
      expect({ name: f.name, warnings: importProfileXml(f.text).warnings })
        .toEqual({ name: f.name, warnings: [] });
    }
  });

  it("name a Connect limited to SSIDs, prefixed with the payload", () => {
    expect(warningsFor(`
      <dict><key>Action</key><string>Connect</string>
            <key>SSIDMatch</key><array><string>Office</string></array></dict>`))
      .toEqual([
        "Example: Left out the “Connect” rule for the Wi-Fi networks “Office”. Only excluding Wi-Fi networks is supported.",
      ]);
  });

  it("name matchers the reader cannot honour", () => {
    const [warning] = warningsFor(`
      <dict><key>Action</key><string>Connect</string>
            <key>InterfaceTypeMatch</key><string>WiFi</string>
            <key>DNSDomainMatch</key><array><string>corp.example</string></array></dict>`);
    expect(warning).toContain("DNSDomainMatch");
    expect(warning).toContain("Wi-Fi");
  });

  it("do not flag an SSID exclusion that also names Wi-Fi", () => {
    expect(warningsFor(`
      <dict><key>Action</key><string>Disconnect</string>
            <key>InterfaceTypeMatch</key><string>WiFi</string>
            <key>SSIDMatch</key><array><string>Home</string></array></dict>`))
      .toEqual([]);
  });

  it("name an interface rule that is neither Connect nor Disconnect", () => {
    const [warning] = warningsFor(`
      <dict><key>Action</key><string>Ignore</string>
            <key>InterfaceTypeMatch</key><string>Cellular</string></dict>`);
    expect(warning).toContain("“Ignore”");
    expect(warning).toContain("cellular");
  });

  it("name domain actions other than NeverConnect", () => {
    const [warning] = warningsFor(`
      <dict><key>Action</key><string>EvaluateConnection</string>
        <key>ActionParameters</key><array><dict>
          <key>DomainAction</key><string>ConnectIfNeeded</string>
          <key>Domains</key><array><string>corp.example</string></array>
        </dict></array></dict>`);
    expect(warning).toContain("ConnectIfNeeded");
    expect(warning).toContain("“corp.example”");
  });

  it("name a rule of an unknown kind", () => {
    const [warning] = warningsFor(`
      <dict><key>Action</key><string>Ignore</string></dict>`);
    expect(warning).toContain("“Ignore”");
  });

  it("name resolver addresses that are not IP addresses", () => {
    const xml = profileXml(dnsPayload()).replace(
      "<key>DNSSettings</key><dict>",
      `<key>DNSSettings</key><dict>
        <key>ServerAddresses</key><array>
          <string>192.0.2.1</string><string>resolver.example</string>
        </array>`,
    );
    const result = importProfileXml(xml);
    expect(result.configs[0]?.serverAddresses).toEqual(["192.0.2.1"]);
    expect(result.warnings).toEqual([
      "Example: Left out resolver addresses that are not IP addresses: “resolver.example”.",
    ]);
  });

  it("list each skipped payload type once", () => {
    const wifi = `<dict>
      <key>PayloadType</key><string>com.apple.wifi.managed</string>
    </dict>`;
    expect(importProfileXml(profileXml(wifi + dnsPayload() + wifi)).warnings)
      .toEqual([
        "Skipped payloads that are not DNS settings: com.apple.wifi.managed.",
      ]);
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

  it("accepts a profile without a DOCTYPE", () => {
    const withDoctype = profileXml(dnsPayload());
    const withoutDoctype = withDoctype.replace(/<!DOCTYPE[^>]*>\n/, "");
    expect(withoutDoctype).not.toContain("<!DOCTYPE");
    expect(parseProfileXml(withoutDoctype)).toEqual(
      parseProfileXml(withDoctype),
    );
  });

  it("accepts a bare <plist> with no XML declaration either", () => {
    const bare = profileXml(dnsPayload()).replace(/^[\s\S]*?(?=<plist)/, "");
    expect(bare.startsWith("<plist")).toBe(true);
    expect(parseProfileXml(bare).length).toBe(1);
  });

  it("does not mistake a longer element name for <plist>", () => {
    expect(() => extractPlistXml("<plistx>nope</plist>")).toThrow(
      ProfileImportError,
    );
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
