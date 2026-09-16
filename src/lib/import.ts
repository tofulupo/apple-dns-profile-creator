/**
 * Recovers DNS configurations from an uploaded `.mobileconfig`.
 */

import { collectServerAddresses } from "./addresses.ts";
import {
  asArray,
  asDict,
  asString,
  asStringArray,
  parsePlist,
  type PlistDict,
  type PlistValue,
} from "./plist.ts";
import type { DnsConfig, DnsProtocol } from "./types.ts";

export class ProfileImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileImportError";
  }
}

const MATCHER_KEYS = [
  "DNSDomainMatch",
  "DNSServerAddressMatch",
  "InterfaceTypeMatch",
  "SSIDMatch",
  "URLStringProbe",
] as const;

export function extractPlistXml(fileText: string): string {
  const match = /<!DOCTYPE plist.+<\/plist>/s.exec(fileText);
  if (match === null) {
    throw new ProfileImportError(
      "No property list found in the uploaded file - is it a configuration profile?",
    );
  }
  return match[0];
}

function readProtocol(dnsSettings: PlistDict | undefined): DnsProtocol {
  const raw = asString(dnsSettings?.["DNSProtocol"]);
  if (raw === "HTTPS" || raw === "TLS") {
    return raw;
  }
  throw new ProfileImportError(
    raw === undefined
      ? "Payload has no DNSProtocol"
      : `Unsupported DNSProtocol ${
        JSON.stringify(raw)
      } - expected "HTTPS" or "TLS"`,
  );
}

function isUnconditional(rule: PlistDict): boolean {
  const action = asString(rule["Action"]);
  if (action !== "Connect" && action !== "Disconnect") {
    return false;
  }
  return MATCHER_KEYS.every((key) => rule[key] === undefined);
}

function defaultInterfaceState(rules: readonly PlistDict[]): boolean {
  const catchAll = rules.find(isUnconditional);
  if (catchAll === undefined) {
    return true;
  }
  return asString(catchAll["Action"]) === "Connect";
}

interface OnDemandSummary {
  readonly excludedWifi: string[];
  readonly excludedDomains: string[];
  readonly useWifi: boolean;
  readonly useCellular: boolean;
  readonly useEthernet: boolean;
}

function readOnDemandRules(payload: PlistDict): OnDemandSummary {
  const rules = (asArray(payload["OnDemandRules"]) ?? [])
    .map((entry) => asDict(entry))
    .filter((entry): entry is PlistDict => entry !== undefined);

  const fallback = defaultInterfaceState(rules);

  const excludedWifi: string[] = [];
  const excludedDomains: string[] = [];
  let useWifi = fallback;
  let useCellular = fallback;
  let useEthernet = fallback;

  for (const rule of rules) {
    const interfaceType = asString(rule["InterfaceTypeMatch"]);
    const action = asString(rule["Action"]);
    const ssidMatch = asStringArray(rule["SSIDMatch"]);

    if (interfaceType === "WiFi") {
      useWifi = action === "Connect";
    } else if (interfaceType === "Cellular") {
      useCellular = action === "Connect";
    } else if (interfaceType === "Ethernet") {
      useEthernet = action === "Connect";
    } else if (ssidMatch !== undefined) {
      excludedWifi.push(...ssidMatch);
    } else if (action === "EvaluateConnection") {
      for (const parameter of asArray(rule["ActionParameters"]) ?? []) {
        const parameters = asDict(parameter);
        if (asString(parameters?.["DomainAction"]) !== "NeverConnect") {
          continue;
        }
        excludedDomains.push(...(asStringArray(parameters?.["Domains"]) ?? []));
      }
    }
  }

  return { excludedWifi, excludedDomains, useWifi, useCellular, useEthernet };
}

export function parseProfile(plist: PlistValue): DnsConfig[] {
  const root = asDict(plist);
  if (root === undefined) {
    throw new ProfileImportError("Profile root is not a dictionary");
  }

  const payloads = asArray(root["PayloadContent"]);
  if (payloads === undefined) {
    throw new ProfileImportError("Profile has no PayloadContent array");
  }

  const configs: DnsConfig[] = [];

  for (const entry of payloads) {
    const payload = asDict(entry);
    if (payload === undefined) {
      continue;
    }

    const dnsSettings = asDict(payload["DNSSettings"]);
    const protocol = readProtocol(dnsSettings);
    const serverKey = protocol === "HTTPS" ? "ServerURL" : "ServerName";
    const rules = readOnDemandRules(payload);
    const matchDomains =
      asStringArray(dnsSettings?.["SupplementalMatchDomains"]) ?? [];

    configs.push({
      name: asString(payload["PayloadDisplayName"]) ?? "",
      protocol,
      serverUrl: asString(dnsSettings?.[serverKey]) ?? "",
      serverAddresses: collectServerAddresses(
        asStringArray(dnsSettings?.["ServerAddresses"]) ?? [],
      ),
      excludedWifi: rules.excludedWifi,
      excludedDomains: rules.excludedDomains,
      useWifi: rules.useWifi,
      useCellular: rules.useCellular,
      useEthernet: rules.useEthernet,
      prohibitDisablement: payload["ProhibitDisablement"] === true,
      // Mirrors the builder: absent rather than falsy, so an import/export
      // cycle reproduces the source profile.
      ...(dnsSettings?.["AllowFailover"] === true && { allowFailover: true }),
      ...(matchDomains.length > 0 &&
        { supplementalMatchDomains: matchDomains }),
    });
  }

  return configs;
}

export function parseProfileXml(fileText: string): DnsConfig[] {
  return parseProfile(parsePlist(extractPlistXml(fileText)));
}
