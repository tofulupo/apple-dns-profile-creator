import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  asArray,
  asDict,
  parsePlist,
  type PlistDict,
} from "../../src/lib/plist.ts";
import {
  addPreset,
  type App,
  cardNames,
  download,
  loadFile,
  openTab,
  press,
  useApp,
} from "./app.ts";

function payloads(xml: string): PlistDict[] {
  return (asArray(asDict(parsePlist(xml))?.["PayloadContent"]) ?? [])
    .map((payload) => asDict(payload) ?? {});
}

function dnsSettings(payload: PlistDict | undefined): PlistDict {
  return asDict(payload?.["DNSSettings"]) ?? {};
}

function profileNamed(name: string): string {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>' +
    "<key>PayloadContent</key><array><dict>" +
    "<key>PayloadType</key><string>com.apple.dnsSettings.managed</string>" +
    `<key>PayloadDisplayName</key><string>${name}</string>` +
    "<key>DNSSettings</key><dict>" +
    "<key>DNSProtocol</key><string>HTTPS</string>" +
    "<key>ServerURL</key><string>https://dns.example.com/dns-query</string>" +
    "</dict></dict></array></dict></plist>";
}

async function openRule(app: App, title: string): Promise<void> {
  const summary = app.$(".rule-list").$(`summary*=${title}`);
  await press(summary);
}

describe({
  name: "everyday flows",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  const app = useApp();

  it("makes a profile from a preset without opening any section", async () => {
    await addPreset(app(), "Quad9");

    const saved = payloads(await download(app()));

    expect(saved).toHaveLength(1);
    expect(saved[0]?.["PayloadType"]).toBe("com.apple.dnsSettings.managed");
    expect(dnsSettings(saved[0])).toMatchObject({
      DNSProtocol: "HTTPS",
      ServerURL: "https://dns.quad9.net/dns-query",
      ServerAddresses: [
        "9.9.9.9",
        "149.112.112.112",
        "2620:fe::fe",
        "2620:fe::9",
      ],
    });
  });

  it("removes a card again", async () => {
    await addPreset(app(), "Quad9");

    await press(app().$('button[aria-label="Delete Quad9"]'));

    await app().$("#emptyState").waitForDisplayed();
    expect(await app().$("#emptyState").getText()).toContain("No config yet");
    expect(await app().$("#profileCount").isDisplayed()).toBe(false);
  });

  it("puts a field back with Escape", async () => {
    const name = app().$("#provName");
    await name.click();
    await name.addValue("Office");
    expect(await name.getValue()).toBe("Office");

    await app().keys("Escape");

    expect(await name.getValue()).toBe("");
  });

  it("sends only the household's own domains to the home resolver", async () => {
    await app().$("#provName").setValue("Home");
    await app().$("#serverUrl").setValue("https://dns.home.example/dns-query");
    await press(app().$("#disclosure-serverAddresses > summary"));
    await app().$("#ipv4a").setValue("192.168.1.10");
    await press(app().$("#disclosure-rules > summary"));
    await openRule(app(), "Domains");
    await app().$("#matchDomains").setValue("*.example.com");
    await press(app().$("label*=Cellular"));
    await press(app().$("#btn_addToProfile"));
    await app().$("#configList").waitForDisplayed();

    const [payload] = payloads(await download(app()));

    expect(dnsSettings(payload)).toMatchObject({
      ServerURL: "https://dns.home.example/dns-query",
      ServerAddresses: ["192.168.1.10"],
      SupplementalMatchDomains: ["*.example.com"],
    });
    expect(payload?.["OnDemandRules"]).toEqual([
      { Action: "Connect", InterfaceTypeMatch: "WiFi" },
      { Action: "Connect", InterfaceTypeMatch: "Ethernet" },
      { Action: "Disconnect" },
    ]);
  });

  it("puts two configurations in one profile, in card order", async () => {
    await addPreset(app(), "Quad9");
    await openTab(app(), "Tool");
    await addPreset(app(), "DNS.SB");

    const saved = payloads(await download(app()));

    expect(saved.map((payload) => payload["PayloadDisplayName"])).toEqual([
      "Quad9",
      "DNS.SB",
    ]);
  });

  it("shows a name with markup from a loaded profile as text", async () => {
    const name = "<img src=x onerror=alert(1)>";
    await loadFile(
      app(),
      "hostile.mobileconfig",
      profileNamed("&lt;img src=x onerror=alert(1)&gt;"),
    );
    await openTab(app(), "Profile");
    await app().$("#configList").waitForDisplayed();

    expect(await cardNames(app())).toEqual([name]);
    expect(
      await app().execute(() => document.querySelectorAll("main img").length),
    ).toBe(0);
  });

  it("lists two resolver addresses per family in order", async () => {
    await addPreset(app(), "DNS.SB");

    const tags = await app().execute(() =>
      [...document.querySelectorAll("#dynamicList .resolver-list li")].map(
        (item) => [
          item.querySelector(".resolver-list__tag")?.textContent,
          item.querySelector(".resolver-list__address")?.textContent,
        ],
      )
    );
    expect(tags).toEqual([
      ["IPv4 1", "45.11.45.11"],
      ["IPv4 2", "185.222.222.222"],
      ["IPv6 1", "2a09::"],
      ["IPv6 2", "2a11::"],
    ]);
  });
});
