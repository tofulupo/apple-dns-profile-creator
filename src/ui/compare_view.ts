import {
  compareConfigs,
  type SettingsField,
  shortHash,
} from "../lib/compare.ts";
import type { DnsConfig } from "../lib/types.ts";
import {
  connectionOf,
  featuresOf,
  interfacesOf,
  lineList,
  paradigmPill,
  pills,
  resolverList,
  rulesOf,
} from "./card_values.ts";

interface Row {
  readonly label: string;
  readonly value: (config: DnsConfig) => Node;
  readonly differs: boolean;
}

function text(value: string, className?: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.textContent = value;
  if (className !== undefined) span.className = className;
  return span;
}

function none(): HTMLSpanElement {
  return text("None", "compare__none");
}

function list(values: readonly string[], build: (v: string[]) => Node): Node {
  return values.length === 0 ? none() : build([...values]);
}

function extensionOf(config: DnsConfig): string | undefined {
  const file = config.source?.file;
  const dot = file?.lastIndexOf(".") ?? -1;
  return file === undefined || dot <= 0 ? undefined : file.slice(dot);
}

function formatOf(config: DnsConfig): Node {
  const extension = extensionOf(config);
  if (config.paradigm === undefined && extension === undefined) return none();
  const value = document.createElement("span");
  value.className = "compare__format";
  if (config.paradigm !== undefined) {
    value.append(paradigmPill(config.paradigm));
  }
  if (extension !== undefined) value.append(text(extension, "mono"));
  return value;
}

function scopeOf(config: DnsConfig): string | undefined {
  const scope = config.source?.systemScope;
  if (config.source === undefined) return undefined;
  return scope === true ? "On" : scope === false ? "Off" : "Not set";
}

function hashOf(config: DnsConfig): Node {
  const sha256 = config.source?.sha256;
  if (sha256 === undefined) return none();
  const hash = text(shortHash(sha256), "mono");
  hash.title = sha256;
  return hash;
}

function key(config: DnsConfig, build: (c: DnsConfig) => unknown): string {
  return JSON.stringify(build(config));
}

function fileRows(a: DnsConfig, b: DnsConfig): Row[] {
  return [
    {
      label: "File",
      value: (c) =>
        c.source === undefined ? none() : text(
          c.source.edited === true
            ? `${c.source.file} (edited)`
            : c.source.file,
        ),
      differs: false,
    },
    {
      label: "Profile ID",
      value: (c) =>
        c.source?.profileId === undefined
          ? none()
          : text(c.source.profileId, "mono"),
      differs: false,
    },
    { label: "SHA-256", value: hashOf, differs: false },
    {
      label: "Format",
      value: formatOf,
      differs: key(a, (c) => [c.paradigm, extensionOf(c)]) !==
        key(b, (c) => [c.paradigm, extensionOf(c)]),
    },
    {
      label: "System scope",
      value: (c) => {
        const scope = scopeOf(c);
        return scope === undefined ? none() : text(scope);
      },
      differs: scopeOf(a) !== scopeOf(b),
    },
  ];
}

function settingsRows(a: DnsConfig, b: DnsConfig): Row[] {
  const differing = new Set<SettingsField>(
    compareConfigs(a, b).filter((row) => row.differs).map((row) => row.field),
  );
  const any = (...fields: SettingsField[]) =>
    fields.some((field) => differing.has(field));
  return [
    {
      label: "Connection",
      value: (c) => text(connectionOf(c)),
      differs: any("protocol"),
    },
    {
      label: "Server",
      value: (c) => text(c.serverUrl, "mono"),
      differs: any("serverUrl"),
    },
    {
      label: "Resolvers",
      value: (c) => list(c.serverAddresses, resolverList),
      differs: any("serverAddresses"),
    },
    {
      label: "Skip for SSID",
      value: (c) =>
        list(c.excludedWifi, (v) => {
          const lines = lineList(v);
          lines.classList.add("mono");
          return lines;
        }),
      differs: any("excludedWifi"),
    },
    {
      label: "Skip for domains",
      value: (c) => list(c.excludedDomains, (v) => text(v.join(", "), "mono")),
      differs: any("excludedDomains"),
    },
    {
      label: "Only for domains",
      value: (c) =>
        list(
          c.supplementalMatchDomains ?? [],
          (v) => text(v.join(", "), "mono"),
        ),
      differs: any("supplementalMatchDomains"),
    },
    {
      label: "Interfaces",
      value: (c) => list(interfacesOf(c), pills),
      differs: any("useWifi", "useCellular", "useEthernet"),
    },
    {
      label: "Rules",
      value: (c) => list(rulesOf(c), pills),
      differs: any("allowFailover", "prohibitDisablement"),
    },
    {
      label: "Features",
      value: (c) => list(featuresOf(c), pills),
      differs: key(a, featuresOf) !== key(b, featuresOf),
    },
  ];
}

const SIDES = ["A", "B"] as const;

function labelOf(config: DnsConfig, side: number): string {
  const name = config.name.trim() === ""
    ? "Unnamed configuration"
    : config.name;
  return `${SIDES[side]} · ${name}`;
}

function body(
  rows: readonly Row[],
  a: DnsConfig,
  b: DnsConfig,
): HTMLTableSectionElement {
  const section = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.className = row.differs
      ? "compare__row compare__row--differs"
      : "compare__row";
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = row.label;
    if (row.differs) {
      th.append(text(", differs", "visually-hidden"));
    }
    tr.append(th);
    for (const [side, config] of [a, b].entries()) {
      const td = document.createElement("td");
      td.dataset["side"] = labelOf(config, side);
      td.append(row.value(config));
      tr.append(td);
    }
    section.append(tr);
  }
  return section;
}

export function compareTable(
  a: DnsConfig,
  b: DnsConfig,
): { table: HTMLTableElement; differences: number } {
  const table = document.createElement("table");
  table.className = "compare__table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  const corner = document.createElement("td");
  headRow.append(corner);
  for (const [side, config] of [a, b].entries()) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = labelOf(config, side);
    headRow.append(th);
  }
  head.append(headRow);
  const files = fileRows(a, b);
  const settings = settingsRows(a, b);
  table.append(head, body(files, a, b), body(settings, a, b));
  const differences = [...files, ...settings].filter((row) => row.differs)
    .length;
  return { table, differences };
}
