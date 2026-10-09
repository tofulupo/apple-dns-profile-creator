import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  connectionOf,
  featuresOf,
  interfacesOf,
  rulesOf,
} from "../../src/ui/card_values.ts";
import { config } from "../helpers/configs.ts";

describe("card values", () => {
  it("name the connection the way the form does", () => {
    expect(connectionOf(config({ protocol: "HTTPS" }))).toBe("DNS over HTTPS");
    expect(connectionOf(config({ protocol: "TLS" }))).toBe("DNS over TLS");
  });

  it("list the interfaces that are on, in the form's order", () => {
    expect(interfacesOf(config({ useCellular: false }))).toEqual([
      "Wi-Fi",
      "Ethernet",
    ]);
    expect(
      interfacesOf(
        config({ useWifi: false, useCellular: false, useEthernet: false }),
      ),
    ).toEqual([]);
  });

  it("list the rules that are on, under the form's names", () => {
    expect(rulesOf(config())).toEqual([]);
    expect(rulesOf(config({ allowFailover: true, prohibitDisablement: true })))
      .toEqual(["Failover", "Lock profile"]);
  });

  it("show a preset's features only for that preset's server", () => {
    const quad9 = {
      protocol: "HTTPS",
      serverUrl: "https://dns.quad9.net/dns-query",
    } as const;
    expect(featuresOf(config(quad9))).toEqual(["DNSSEC", "Malware blocking"]);
    expect(featuresOf(config({ ...quad9, protocol: "TLS" }))).toEqual([]);
    expect(featuresOf(config())).toEqual([]);
  });
});
