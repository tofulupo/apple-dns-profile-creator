import { collectServerAddresses, limitServerAddresses } from "./addresses.ts";
import {
  asArray,
  asDict,
  asString,
  asStringArray,
  parsePlist,
  type PlistDict,
  type PlistValue,
} from "./plist.ts";
import {
  ACTIVATION_DECLARATION_TYPE,
  DECLARATIONS_PAYLOAD_TYPE,
  DNS_DECLARATION_TYPE,
  DNS_PAYLOAD_TYPE,
} from "./profile.ts";
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
  // From `<!DOCTYPE plist` or, without one, `<plist` through `</plist>`.
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

export interface ProfileImport {
  readonly configs: DnsConfig[];
  readonly warnings: string[];
  readonly usesDeprecatedPayload: boolean;
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

function readOnDemandRules(
  rulesHolder: PlistDict,
  warn: Warn,
): OnDemandSummary {
  const rules = (asArray(rulesHolder["OnDemandRules"]) ?? [])
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

function readConfig(name: string, holder: PlistDict, warn: Warn): DnsConfig {
  const dnsSettings = asDict(holder["DNSSettings"]);
  const protocol = readProtocol(dnsSettings);
  const serverKey = protocol === "HTTPS" ? "ServerURL" : "ServerName";
  const rules = readOnDemandRules(holder, warn);
  const matchDomains =
    asStringArray(dnsSettings?.["SupplementalMatchDomains"]) ?? [];

  const listedAddresses = asStringArray(dnsSettings?.["ServerAddresses"]) ??
    [];
  const validAddresses = collectServerAddresses(listedAddresses);
  const badAddresses = listedAddresses.filter((address) =>
    !validAddresses.includes(address)
  );
  if (badAddresses.length > 0) {
    warn(
      `Left out resolver addresses that are not IP addresses: ${
        quoteList(badAddresses)
      }.`,
    );
  }

  const { kept: serverAddresses, dropped: extraAddresses } =
    limitServerAddresses(validAddresses);
  if (extraAddresses.length > 0) {
    warn(
      `Left out resolver addresses beyond two IPv4 and two IPv6: ${
        quoteList(extraAddresses)
      }.`,
    );
  }

  return {
    name,
    protocol,
    serverUrl: asString(dnsSettings?.[serverKey]) ?? "",
    serverAddresses,
    excludedWifi: rules.excludedWifi,
    excludedDomains: rules.excludedDomains,
    useWifi: rules.useWifi,
    useCellular: rules.useCellular,
    useEthernet: rules.useEthernet,
    prohibitDisablement: holder["ProhibitDisablement"] === true,
    // Absent rather than false, as in buildDnsSettings, so a round trip
    // reproduces the source profile.
    ...(dnsSettings?.["AllowFailover"] === true && { allowFailover: true }),
    ...(matchDomains.length > 0 &&
      { supplementalMatchDomains: matchDomains }),
  };
}

function readDeclarations(payload: PlistDict, warn: Warn): PlistDict[] {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const declarations: PlistDict[] = [];
  for (const item of asArray(payload["Declarations"]) ?? []) {
    let declaration: PlistDict | undefined;
    try {
      declaration = item instanceof Uint8Array
        ? asDict(JSON.parse(decoder.decode(item)) as PlistValue)
        : undefined;
    } catch {
      declaration = undefined;
    }
    if (declaration === undefined) {
      warn("Left out a declaration that could not be read.");
    } else {
      declarations.push(declaration);
    }
  }
  return declarations;
}

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
  const skippedDeclarationTypes = new Set<string>();
  let usesDeprecatedPayload = false;
  const warnFor = (name: string): Warn => (message) =>
    warnings.push(name === "" ? message : `${name}: ${message}`);

  for (const entry of payloads) {
    const payload = asDict(entry);
    if (payload === undefined) {
      continue;
    }
    const payloadType = asString(payload["PayloadType"]);

    if (payloadType === DECLARATIONS_PAYLOAD_TYPE) {
      for (const declaration of readDeclarations(payload, warnFor(""))) {
        const type = asString(declaration["Type"]) ?? "no type";
        const body = asDict(declaration["Payload"]);
        if (type === DNS_DECLARATION_TYPE && body !== undefined) {
          const name = asString(body["VisibleName"]) ?? "";
          configs.push(readConfig(name, body, warnFor(name)));
        } else if (type !== ACTIVATION_DECLARATION_TYPE) {
          skippedDeclarationTypes.add(type);
        }
      }
      continue;
    }

    if (payloadType !== undefined && payloadType !== DNS_PAYLOAD_TYPE) {
      skippedTypes.add(payloadType);
      continue;
    }

    const name = asString(payload["PayloadDisplayName"]) ?? "";
    configs.push({
      ...readConfig(name, payload, warnFor(name)),
      fromDeprecatedPayload: true,
    });
    usesDeprecatedPayload = true;
  }

  if (skippedTypes.size > 0) {
    warnings.push(
      `Skipped payloads that are not DNS settings: ${
        [...skippedTypes].join(", ")
      }.`,
    );
  }
  if (skippedDeclarationTypes.size > 0) {
    warnings.push(
      `Skipped declarations that are not DNS settings: ${
        [...skippedDeclarationTypes].join(", ")
      }.`,
    );
  }

  return { configs, warnings, usesDeprecatedPayload };
}

export function importProfileXml(fileText: string): ProfileImport {
  return importProfile(parsePlist(extractPlistXml(fileText)));
}

export function parseProfile(plist: PlistValue): DnsConfig[] {
  return importProfile(plist).configs;
}

export function parseProfileXml(fileText: string): DnsConfig[] {
  return importProfileXml(fileText).configs;
}
