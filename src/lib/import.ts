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
import { DNS_PAYLOAD_TYPE } from "./profile.ts";
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
  // The DOCTYPE is optional: plutil and hand-written profiles may omit it and
  // start straight at <plist>. Anything before the match, such as the DER
  // wrapper of a signed profile or the XML declaration, is dropped.
  const match = /(?:<!DOCTYPE plist|<plist[\s>]).*<\/plist>/s.exec(fileText);
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

/** What an import produced, and what it could not carry over. */
export interface ProfileImport {
  readonly configs: DnsConfig[];
  /**
   * One sentence per part of the source profile that was left out or read
   * only partly, for showing to the user. Empty for profiles this tool built.
   */
  readonly warnings: string[];
}

type Warn = (message: string) => void;
type MatcherKey = (typeof MATCHER_KEYS)[number];

const INTERFACE_LABELS = {
  WiFi: "Wi-Fi",
  Cellular: "cellular",
  Ethernet: "Ethernet",
} as const;

type InterfaceType = keyof typeof INTERFACE_LABELS;

function isInterfaceType(value: string | undefined): value is InterfaceType {
  return value !== undefined && Object.hasOwn(INTERFACE_LABELS, value);
}

function quoteList(values: readonly string[]): string {
  return values.map((value) => `“${value}”`).join(", ");
}

/** Reports matchers on `rule` beyond `used`, which the reader cannot honour. */
function warnIgnoredMatchers(
  rule: PlistDict,
  used: readonly MatcherKey[],
  subject: string,
  warn: Warn,
): void {
  const ignored = MATCHER_KEYS.filter((key) =>
    !used.includes(key) && rule[key] !== undefined
  );
  if (ignored.length > 0) {
    warn(`Ignored the ${ignored.join(", ")} condition of the rule ${subject}.`);
  }
}

interface OnDemandSummary {
  readonly excludedWifi: string[];
  readonly excludedDomains: string[];
  readonly useWifi: boolean;
  readonly useCellular: boolean;
  readonly useEthernet: boolean;
}

function readOnDemandRules(payload: PlistDict, warn: Warn): OnDemandSummary {
  const rules = (asArray(payload["OnDemandRules"]) ?? [])
    .map((entry) => asDict(entry))
    .filter((entry): entry is PlistDict => entry !== undefined);

  const fallback = defaultInterfaceState(rules);

  const excludedWifi: string[] = [];
  const excludedDomains: string[] = [];
  const enabled: Record<InterfaceType, boolean> = {
    WiFi: fallback,
    Cellular: fallback,
    Ethernet: fallback,
  };

  for (const rule of rules) {
    const interfaceType = asString(rule["InterfaceTypeMatch"]);
    const action = asString(rule["Action"]);
    const actionName = `“${action ?? "no action"}”`;
    const ssidMatch = asStringArray(rule["SSIDMatch"]);

    // Checked first: an SSID rule is narrower than its interface, so it must
    // not switch the whole interface on or off even if it also names one. Only
    // a Disconnect is an exclusion; a Connect limited to some SSIDs has no
    // equivalent in DnsConfig and is left out rather than inverted.
    if (ssidMatch !== undefined) {
      const subject = `for the Wi-Fi networks ${quoteList(ssidMatch)}`;
      if (action === "Disconnect") {
        excludedWifi.push(...ssidMatch);
        warnIgnoredMatchers(
          rule,
          ["SSIDMatch", "InterfaceTypeMatch"],
          subject,
          warn,
        );
      } else {
        warn(
          `Left out the ${actionName} rule ${subject}. Only excluding Wi-Fi networks is supported.`,
        );
      }
    } else if (isInterfaceType(interfaceType)) {
      const subject = `for ${INTERFACE_LABELS[interfaceType]}`;
      if (action !== "Connect" && action !== "Disconnect") {
        warn(
          `Read the ${actionName} rule ${subject} as Disconnect. Only Connect and Disconnect are supported per interface.`,
        );
      }
      enabled[interfaceType] = action === "Connect";
      warnIgnoredMatchers(rule, ["InterfaceTypeMatch"], subject, warn);
    } else if (action === "EvaluateConnection") {
      for (const parameter of asArray(rule["ActionParameters"]) ?? []) {
        const parameters = asDict(parameter);
        const domains = asStringArray(parameters?.["Domains"]) ?? [];
        const domainAction = asString(parameters?.["DomainAction"]);
        if (domainAction === "NeverConnect") {
          excludedDomains.push(...domains);
        } else {
          warn(
            `Left out “${domainAction ?? "no action"}” for the domains ${
              quoteList(domains)
            }. Only excluding domains is supported.`,
          );
        }
      }
      warnIgnoredMatchers(rule, [], "for excluded domains", warn);
    } else if (!isUnconditional(rule)) {
      warn(
        `Left out an on-demand rule with action ${actionName} that this tool cannot represent.`,
      );
    }
  }

  return {
    excludedWifi,
    excludedDomains,
    useWifi: enabled.WiFi,
    useCellular: enabled.Cellular,
    useEthernet: enabled.Ethernet,
  };
}

/**
 * Reads every DNS payload in a profile, and describes anything it had to
 * leave out. Throws `ProfileImportError` when the profile is unusable.
 */
export function importProfile(plist: PlistValue): ProfileImport {
  const root = asDict(plist);
  if (root === undefined) {
    throw new ProfileImportError("Profile root is not a dictionary");
  }

  const payloads = asArray(root["PayloadContent"]);
  if (payloads === undefined) {
    throw new ProfileImportError("Profile has no PayloadContent array");
  }

  const configs: DnsConfig[] = [];
  const warnings: string[] = [];
  const skippedTypes = new Set<string>();

  for (const entry of payloads) {
    const payload = asDict(entry);
    if (payload === undefined) {
      continue;
    }
    // Profiles often bundle DNS with other payloads (Wi-Fi, certificates...).
    // Those are skipped. A payload with no PayloadType at all is still read,
    // so a hand-trimmed profile keeps working.
    const payloadType = asString(payload["PayloadType"]);
    if (payloadType !== undefined && payloadType !== DNS_PAYLOAD_TYPE) {
      skippedTypes.add(payloadType);
      continue;
    }

    const name = asString(payload["PayloadDisplayName"]) ?? "";
    const warn: Warn = (message) =>
      warnings.push(name === "" ? message : `${name}: ${message}`);

    const dnsSettings = asDict(payload["DNSSettings"]);
    const protocol = readProtocol(dnsSettings);
    const serverKey = protocol === "HTTPS" ? "ServerURL" : "ServerName";
    const rules = readOnDemandRules(payload, warn);
    const matchDomains =
      asStringArray(dnsSettings?.["SupplementalMatchDomains"]) ?? [];

    const listedAddresses = asStringArray(dnsSettings?.["ServerAddresses"]) ??
      [];
    const serverAddresses = collectServerAddresses(listedAddresses);
    const badAddresses = listedAddresses.filter((address) =>
      !serverAddresses.includes(address)
    );
    if (badAddresses.length > 0) {
      warn(
        `Left out resolver addresses that are not IP addresses: ${
          quoteList(badAddresses)
        }.`,
      );
    }

    configs.push({
      name,
      protocol,
      serverUrl: asString(dnsSettings?.[serverKey]) ?? "",
      serverAddresses,
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

  if (skippedTypes.size > 0) {
    warnings.push(
      `Skipped payloads that are not DNS settings: ${
        [...skippedTypes].join(", ")
      }.`,
    );
  }

  return { configs, warnings };
}

export function importProfileXml(fileText: string): ProfileImport {
  return importProfile(parsePlist(extractPlistXml(fileText)));
}

/** `importProfile` without the warnings. */
export function parseProfile(plist: PlistValue): DnsConfig[] {
  return importProfile(plist).configs;
}

/** `importProfileXml` without the warnings. */
export function parseProfileXml(fileText: string): DnsConfig[] {
  return importProfileXml(fileText).configs;
}
