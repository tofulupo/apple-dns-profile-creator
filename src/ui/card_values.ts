import { presetFeatures, presetOf } from "../config.ts";
import type { DnsConfig, ProfileFormat } from "../lib/types.ts";
import { isIPv4, isIPv6 } from "../lib/validate.ts";

export function badge(label: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "badge";
  span.textContent = label;
  return span;
}

export function pills(names: readonly string[]): HTMLSpanElement {
  const list = document.createElement("span");
  list.className = "profile-card__pills";
  list.append(...names.map(badge));
  return list;
}

export function resolverList(addresses: readonly string[]): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "resolver-list";
  list.setAttribute("role", "list");
  const counts = { IPv4: 0, IPv6: 0 };
  for (const address of addresses) {
    const family = isIPv4(address)
      ? "IPv4"
      : isIPv6(address)
      ? "IPv6"
      : undefined;
    const tag = document.createElement("span");
    tag.className = "resolver-list__tag";
    tag.textContent = family === undefined
      ? "?"
      : `${family} ${++counts[family]}`;
    const value = document.createElement("span");
    value.className = "resolver-list__address";
    value.textContent = address;
    const item = document.createElement("li");
    item.append(tag, value);
    list.append(item);
  }
  return list;
}

export function lineList(values: readonly string[]): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "line-list";
  list.setAttribute("role", "list");
  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  }
  return list;
}

const PARADIGMS: Readonly<
  Record<
    ProfileFormat,
    { label: string; modifier: string; explanation: string }
  >
> = {
  payload: {
    label: "Legacy",
    modifier: "badge--legacy",
    explanation:
      "Uses the classic DNS payload, deprecated in iOS 27 and macOS 27",
  },
  declarations: {
    label: "Declarative",
    modifier: "badge--declarative",
    explanation: "Uses DNS declarations, for iOS 26 and macOS 26 and later",
  },
};

export function paradigmPill(paradigm: ProfileFormat): HTMLSpanElement {
  const { label, modifier, explanation } = PARADIGMS[paradigm];
  const pill = badge(label);
  pill.classList.add(modifier);
  pill.title = explanation;
  const hidden = document.createElement("span");
  hidden.className = "visually-hidden";
  hidden.textContent = `: ${explanation}`;
  pill.append(hidden);
  return pill;
}

export function connectionOf(config: DnsConfig): string {
  return config.protocol === "HTTPS" ? "DNS over HTTPS" : "DNS over TLS";
}

export function interfacesOf(config: DnsConfig): string[] {
  return [
    ...(config.useWifi ? ["Wi-Fi"] : []),
    ...(config.useCellular ? ["Cellular"] : []),
    ...(config.useEthernet ? ["Ethernet"] : []),
  ];
}

export function rulesOf(config: DnsConfig): string[] {
  return [
    ...(config.allowFailover === true ? ["Failover"] : []),
    ...(config.prohibitDisablement ? ["Lock profile"] : []),
  ];
}

export function featuresOf(config: DnsConfig): string[] {
  const preset = presetOf(config);
  return preset === undefined ? [] : presetFeatures(preset);
}
