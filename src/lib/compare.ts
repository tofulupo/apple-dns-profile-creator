import type { DnsConfig } from "./types.ts";
import { isIPv4, isIPv6 } from "./validate.ts";

export type SettingsField = Exclude<keyof DnsConfig, "paradigm" | "source">;

export interface CompareRow {
  readonly field: SettingsField;
  readonly left: unknown;
  readonly right: unknown;
  readonly differs: boolean;
}

const FIELDS: readonly SettingsField[] = [
  "name",
  "protocol",
  "serverUrl",
  "serverAddresses",
  "excludedWifi",
  "excludedDomains",
  "supplementalMatchDomains",
  "useWifi",
  "useCellular",
  "useEthernet",
  "allowFailover",
  "prohibitDisablement",
];

function valueOf(config: DnsConfig, field: SettingsField): unknown {
  switch (field) {
    case "allowFailover":
      return config.allowFailover === true;
    case "supplementalMatchDomains":
      return config.supplementalMatchDomains ?? [];
    default:
      return config[field];
  }
}

export function compareConfigs(a: DnsConfig, b: DnsConfig): CompareRow[] {
  return FIELDS.map((field) => {
    const left = valueOf(a, field);
    const right = valueOf(b, field);
    return {
      field,
      left,
      right,
      differs: JSON.stringify(left) !== JSON.stringify(right),
    };
  });
}

export function shortHash(sha256: string): string {
  return sha256.slice(0, 8);
}

export function sameFile(a: DnsConfig, b: DnsConfig): boolean {
  const hash = a.source?.sha256;
  return hash !== undefined && hash === b.source?.sha256;
}

export type Side = "A" | "B";

export function onlyIn(
  mine: readonly string[],
  other: readonly string[],
): string[] {
  return mine.filter((value) => !other.includes(value));
}

function named(values: readonly string[], side: Side): string {
  return values.length <= 2
    ? `${values.join(", ")} only in ${side}`
    : `${values.length} only in ${side}`;
}

/** What differs between two lists, as a sentence; undefined if nothing. */
export function listDetail(
  a: readonly string[],
  b: readonly string[],
  sameEntries = "Same entries, different order",
): string | undefined {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
  const onlyA = onlyIn(a, b);
  const onlyB = onlyIn(b, a);
  if (onlyA.length === 0 && onlyB.length === 0) return sameEntries;
  return [
    ...(onlyA.length > 0 ? [named(onlyA, "A")] : []),
    ...(onlyB.length > 0 ? [named(onlyB, "B")] : []),
  ].join(" · ");
}

/** "Only for domains": an empty list means every domain. */
export function matchDomainsDetail(
  a: readonly string[],
  b: readonly string[],
): string | undefined {
  if ((a.length === 0) !== (b.length === 0)) {
    return `${a.length === 0 ? "A" : "B"} is used for all domains`;
  }
  return listDetail(a, b);
}

export interface ResolverSlot {
  /** "IPv4 1", "IPv6 2", or "? 1" for an address that is neither. */
  readonly label: string;
  readonly a: string | undefined;
  readonly b: string | undefined;
}

function slotsOf(addresses: readonly string[]): Map<string, string> {
  const counts = { IPv4: 0, IPv6: 0, "?": 0 };
  const slots = new Map<string, string>();
  for (const address of addresses) {
    const family = isIPv4(address) ? "IPv4" : isIPv6(address) ? "IPv6" : "?";
    slots.set(`${family} ${++counts[family]}`, address);
  }
  return slots;
}

const FAMILY_ORDER = ["IPv4", "IPv6", "?"];

function slotOrder(label: string): [number, number] {
  const [family = "", number = "0"] = label.split(" ");
  return [FAMILY_ORDER.indexOf(family), Number(number)];
}

/** Pairs the resolver addresses of A and B by family and position. */
export function resolverSlots(
  a: readonly string[],
  b: readonly string[],
): ResolverSlot[] {
  const left = slotsOf(a);
  const right = slotsOf(b);
  return [...new Set([...left.keys(), ...right.keys()])]
    .sort((x, y) => {
      const [familyX, numberX] = slotOrder(x);
      const [familyY, numberY] = slotOrder(y);
      return familyX - familyY || numberX - numberY;
    })
    .map((label) => ({ label, a: left.get(label), b: right.get(label) }));
}

/** True when both sides list the same addresses, only in another order. */
export function reordered(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return JSON.stringify(a) !== JSON.stringify(b) &&
    onlyIn(a, b).length === 0 && onlyIn(b, a).length === 0;
}

export function resolverDetail(
  a: readonly string[],
  b: readonly string[],
): string | undefined {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
  if (reordered(a, b)) return "Same addresses, different order";
  const slots = resolverSlots(a, b);
  const changed = slots.filter((slot) => slot.a !== slot.b).length;
  return `${changed} of ${slots.length} addresses differ`;
}
