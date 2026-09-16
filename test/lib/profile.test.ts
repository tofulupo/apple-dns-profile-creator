/**
 * Specification tests for the export direction (`src/lib/profile.ts`).
 *
 * Expected behaviour is derived from Apple's `com.apple.dnsSettings.managed`
 * payload and from the conventions observable in the upstream fixture corpus
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { asArray, asDict, type PlistDict } from "../../src/lib/plist.ts";
import { buildProfile } from "../../src/lib/profile.ts";
import { config } from "../helpers/configs.ts";
import { stubUuid } from "../helpers/uuid.ts";

function build(configs = [config()], systemScope = false): PlistDict {
  return buildProfile(configs, { systemScope }, stubUuid());
}

function payloadsOf(profile: PlistDict): PlistDict[] {
  return (asArray(profile["PayloadContent"]) ?? [])
    .map((entry) => asDict(entry))
    .filter((entry): entry is PlistDict => entry !== undefined);
}

function onlyPayload(profile: PlistDict): PlistDict {
  const payloads = payloadsOf(profile);
  expect(payloads).toHaveLength(1);
  return payloads[0] as PlistDict;
}

function dnsSettingsOf(payload: PlistDict): PlistDict {
  const settings = asDict(payload["DNSSettings"]);
  expect(settings).toBeDefined();
  return settings as PlistDict;
}

function rulesOf(payload: PlistDict): PlistDict[] {
  return (asArray(payload["OnDemandRules"]) ?? [])
    .map((entry) => asDict(entry))
    .filter((entry): entry is PlistDict => entry !== undefined);
}

describe("profile envelope", () => {
  it("is a Configuration payload at version 1", () => {
    const profile = build();
    expect(profile["PayloadType"]).toBe("Configuration");
    expect(profile["PayloadVersion"]).toBe(1);
    expect(profile["PayloadRemovalDisallowed"]).toBe(false);
    expect(profile["PayloadDisplayName"]).toBe("Encrypted DNS (DoH, DoT)");
  });

  it("namespaces PayloadIdentifier, overridably", () => {
    expect(build()["PayloadIdentifier"]).toMatch(/^local\.encrypted-dns\./);

    const custom = buildProfile(
      [config()],
      { systemScope: false, identifierPrefix: "com.example.dns." },
      stubUuid(),
    );
    expect(custom["PayloadIdentifier"]).toMatch(/^com\.example\.dns\./);
  });

  it("adds PayloadScope only when system scope is requested", () => {
    expect(build([config()], false)["PayloadScope"]).toBeUndefined();
    expect(build([config()], true)["PayloadScope"]).toBe("System");
  });

  it("emits one payload per configuration", () => {
    const profile = build([
      config({ name: "First" }),
      config({ name: "Second" }),
      config({ name: "Third" }),
    ]);
    const payloads = payloadsOf(profile);
    expect(payloads).toHaveLength(3);
    expect(payloads.map((p) => p["PayloadDisplayName"])).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("draws every identifier from the injected factory, without reuse", () => {
    const uuid = stubUuid();
    const profile = buildProfile(
      [config(), config()],
      { systemScope: false },
      uuid,
    );

    expect(uuid.calls).toHaveLength(6);
    expect(new Set(uuid.calls).size).toBe(6);

    const identifiers = [
      profile["PayloadIdentifier"],
      profile["PayloadUUID"],
      ...payloadsOf(profile).flatMap((p) => [
        p["PayloadIdentifier"],
        p["PayloadUUID"],
      ]),
    ];
    expect(new Set(identifiers).size).toBe(6);
  });
});

describe("DNS payload", () => {
  it("is a managed DNS settings payload at version 1", () => {
    const payload = onlyPayload(build());
    expect(payload["PayloadType"]).toBe("com.apple.dnsSettings.managed");
    expect(payload["PayloadVersion"]).toBe(1);
  });

  it("uses ServerURL for DoH and never ServerName", () => {
    const payload = onlyPayload(
      build([config({ protocol: "HTTPS", serverUrl: "https://e.test/q" })]),
    );
    const settings = dnsSettingsOf(payload);
    expect(settings["DNSProtocol"]).toBe("HTTPS");
    expect(settings["ServerURL"]).toBe("https://e.test/q");
    expect(settings["ServerName"]).toBeUndefined();
  });

  it("uses ServerName for DoT and never ServerURL", () => {
    const payload = onlyPayload(
      build([config({ protocol: "TLS", serverUrl: "dot.e.test" })]),
    );
    const settings = dnsSettingsOf(payload);
    expect(settings["DNSProtocol"]).toBe("TLS");
    expect(settings["ServerName"]).toBe("dot.e.test");
    expect(settings["ServerURL"]).toBeUndefined();
  });

  it("omits AllowFailover unless it is switched on", () => {
    expect(dnsSettingsOf(onlyPayload(build()))["AllowFailover"])
      .toBeUndefined();
    expect(
      dnsSettingsOf(onlyPayload(build([config({ allowFailover: false })])))[
        "AllowFailover"
      ],
    ).toBeUndefined();
    expect(
      dnsSettingsOf(onlyPayload(build([config({ allowFailover: true })])))[
        "AllowFailover"
      ],
    ).toBe(true);
  });

  it("omits SupplementalMatchDomains unless domains are given", () => {
    expect(dnsSettingsOf(onlyPayload(build()))["SupplementalMatchDomains"])
      .toBeUndefined();
    expect(
      dnsSettingsOf(
        onlyPayload(build([config({ supplementalMatchDomains: [] })])),
      )["SupplementalMatchDomains"],
    ).toBeUndefined();
    expect(
      dnsSettingsOf(
        onlyPayload(
          build([
            config({
              supplementalMatchDomains: ["*.example.com", "internal.lan"],
            }),
          ]),
        ),
      )["SupplementalMatchDomains"],
    ).toEqual(["*.example.com", "internal.lan"]);
  });

  it("emits ServerAddresses in the order given", () => {
    const payload = onlyPayload(build());
    expect(dnsSettingsOf(payload)["ServerAddresses"]).toEqual([
      "2001:db8::1",
      "2001:db8::2",
      "192.0.2.1",
      "192.0.2.2",
    ]);
  });

  it("accepts more than two addresses per family", () => {
    const payload = onlyPayload(
      build([
        config({
          serverAddresses: [
            "2001:db8::1",
            "2001:db8::2",
            "2001:db8::3",
            "192.0.2.1",
            "192.0.2.2",
            "192.0.2.3",
          ],
        }),
      ]),
    );
    expect(dnsSettingsOf(payload)["ServerAddresses"]).toHaveLength(6);
  });

  it("omits malformed resolver addresses rather than emitting them", () => {
    const payload = onlyPayload(
      build([
        config({
          serverAddresses: ["999.1.1.1", "not-an-address", "2001:db8::1"],
        }),
      ]),
    );
    expect(dnsSettingsOf(payload)["ServerAddresses"]).toEqual(["2001:db8::1"]);
  });

  it("mirrors ProhibitDisablement", () => {
    expect(onlyPayload(build())["ProhibitDisablement"]).toBe(false);
    expect(
      onlyPayload(build([config({ prohibitDisablement: true })]))[
        "ProhibitDisablement"
      ],
    ).toBe(true);
  });
});

describe("on-demand rules", () => {
  it("ends with an unconditional Disconnect", () => {
    const rules = rulesOf(onlyPayload(build()));
    expect(rules.at(-1)).toEqual({ Action: "Disconnect" });
  });

  it("emits a Connect rule only for enabled interfaces", () => {
    const rules = rulesOf(
      onlyPayload(
        build([
          config({ useWifi: true, useCellular: false, useEthernet: true }),
        ]),
      ),
    );
    expect(rules.filter((r) => r["Action"] === "Connect")).toEqual([
      { Action: "Connect", InterfaceTypeMatch: "WiFi" },
      { Action: "Connect", InterfaceTypeMatch: "Ethernet" },
    ]);
  });

  it("disconnects on excluded SSIDs, ahead of any Connect rule", () => {
    const rules = rulesOf(
      onlyPayload(build([config({ excludedWifi: ["Home", "Office"] })])),
    );
    expect(rules[0]).toEqual({
      Action: "Disconnect",
      SSIDMatch: ["Home", "Office"],
    });
    const firstConnect = rules.findIndex((r) => r["Action"] === "Connect");
    expect(firstConnect).toBeGreaterThan(0);
  });

  it("expresses excluded domains as EvaluateConnection / NeverConnect", () => {
    const rules = rulesOf(
      onlyPayload(
        build([config({ excludedDomains: ["example.com", "internal.lan"] })]),
      ),
    );
    expect(rules[0]).toEqual({
      Action: "EvaluateConnection",
      ActionParameters: [
        {
          DomainAction: "NeverConnect",
          Domains: ["example.com", "internal.lan"],
        },
      ],
    });
  });

  it("puts SSID exclusions before domain exclusions", () => {
    const rules = rulesOf(
      onlyPayload(
        build([
          config({ excludedWifi: ["Home"], excludedDomains: ["example.com"] }),
        ]),
      ),
    );
    expect(rules.map((r) => r["Action"])).toEqual([
      "Disconnect",
      "EvaluateConnection",
      "Connect",
      "Connect",
      "Connect",
      "Disconnect",
    ]);
  });
});
