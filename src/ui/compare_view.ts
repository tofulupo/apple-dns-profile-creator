import {
  compareConfigs,
  listDetail,
  matchDomainsDetail,
  reordered,
  resolverDetail,
  type ResolverSlot,
  resolverSlots,
  sameFile,
  type SettingsField,
  shortHash,
  type Side,
} from "../lib/compare.ts";
import type { DnsConfig, ProfileFormat } from "../lib/types.ts";
import {
  connectionOf,
  featuresOf,
  interfacesOf,
  paradigmPill,
  rulesOf,
} from "./card_values.ts";

type Value = () => Node;

interface Field {
  readonly label: string;
  readonly differs: boolean;
  /** What differs, as a sentence under the label. */
  readonly detail?: string | undefined;
  /** Long monospace values: below 360px A goes above B. */
  readonly long?: boolean;
  readonly a?: Value;
  readonly b?: Value;
  readonly slots?: readonly ResolverSlot[];
}

function tag(
  name: string,
  className: string,
  ...children: (Node | string)[]
): HTMLElement {
  const node = document.createElement(name);
  if (className !== "") node.className = className;
  node.append(...children);
  return node;
}

function hidden(text: string): HTMLElement {
  return tag("span", "visually-hidden", text);
}

function none(text = "None"): HTMLElement {
  return tag("span", "compare-none", text);
}

/** Lets URLs and IDs wrap after a slash or a dot instead of mid-word. */
function breakable(value: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  value.split(/(?<=[/.])/).forEach((part, index) => {
    if (index > 0) fragment.append(document.createElement("wbr"));
    fragment.append(part);
  });
  return fragment;
}

function text(value: string, mono = false): Value {
  return () => tag("span", mono ? "mono" : "", breakable(value));
}

function chips(
  mine: readonly string[],
  other: readonly string[],
  options: { all?: readonly string[]; mono?: boolean; empty?: string } = {},
): HTMLElement {
  const shown = options.all === undefined
    ? [...mine]
    : options.all.filter((value) =>
      mine.includes(value) || other.includes(value)
    );
  if (shown.length === 0) return none(options.empty);
  const list = tag("span", "compare-chips");
  for (const value of shown) {
    const chip = tag(
      "span",
      options.mono === true ? "compare-chip mono" : "compare-chip",
      value,
    );
    if (!mine.includes(value)) {
      chip.classList.add("compare-chip--missing");
      chip.append(hidden(", not set here"));
    } else if (!other.includes(value)) {
      chip.classList.add("compare-chip--only");
      chip.append(hidden(", only here"));
    }
    list.append(chip);
  }
  return list;
}

function numbered(addresses: readonly string[]): HTMLElement {
  if (addresses.length === 0) return none();
  const list = tag("ol", "compare-ordered");
  addresses.forEach((address, index) =>
    list.append(
      tag(
        "li",
        "",
        tag("span", "compare-ordered__n", String(index + 1)),
        tag("span", "mono", address),
      ),
    )
  );
  return list;
}

function scopeOf(config: DnsConfig): string {
  const scope = config.source?.systemScope;
  return scope === true ? "On" : scope === false ? "Off" : "Not set";
}

function fieldsOf(
  a: DnsConfig,
  b: DnsConfig,
  unsaved: ProfileFormat,
): Field[] {
  const differing = new Set<SettingsField>(
    compareConfigs(a, b).filter((row) => row.differs).map((row) => row.field),
  );
  const any = (...fields: SettingsField[]) =>
    fields.some((field) => differing.has(field));
  const formatOf = (config: DnsConfig) => config.paradigm ?? unsaved;
  const format = (config: DnsConfig): Value => () =>
    paradigmPill(formatOf(config));
  const list = (
    label: string,
    left: readonly string[],
    right: readonly string[],
    options: { all?: readonly string[]; mono?: boolean; empty?: string } = {},
  ): Field => {
    const detail = label === "Only for domains"
      ? matchDomainsDetail(left, right)
      : listDetail(left, right);
    return {
      label,
      differs: detail !== undefined,
      detail,
      long: options.mono === true,
      a: () => chips(left, right, options),
      b: () => chips(right, left, options),
    };
  };

  const addressesA = a.serverAddresses;
  const addressesB = b.serverAddresses;
  const resolvers: Field = reordered(addressesA, addressesB)
    ? {
      label: "Resolvers",
      differs: true,
      detail: resolverDetail(addressesA, addressesB),
      long: true,
      a: () => numbered(addressesA),
      b: () => numbered(addressesB),
    }
    : {
      label: "Resolvers",
      differs: any("serverAddresses"),
      detail: resolverDetail(addressesA, addressesB),
      long: true,
      slots: resolverSlots(addressesA, addressesB),
    };

  return [
    {
      label: "Format",
      differs: formatOf(a) !== formatOf(b),
      a: format(a),
      b: format(b),
    },
    {
      label: "System scope",
      differs: scopeOf(a) !== scopeOf(b),
      a: text(scopeOf(a)),
      b: text(scopeOf(b)),
    },
    {
      label: "Connection",
      differs: any("protocol"),
      a: text(connectionOf(a)),
      b: text(connectionOf(b)),
    },
    {
      label: "Server",
      differs: any("serverUrl"),
      long: true,
      a: text(a.serverUrl, true),
      b: text(b.serverUrl, true),
    },
    resolvers,
    list("Skip for SSID", a.excludedWifi, b.excludedWifi, { mono: true }),
    list("Skip for domains", a.excludedDomains, b.excludedDomains, {
      mono: true,
    }),
    list(
      "Only for domains",
      a.supplementalMatchDomains ?? [],
      b.supplementalMatchDomains ?? [],
      { mono: true, empty: "All domains" },
    ),
    list("Interfaces", interfacesOf(a), interfacesOf(b), {
      all: ["Wi-Fi", "Cellular", "Ethernet"],
    }),
    list("Rules", rulesOf(a), rulesOf(b), {
      all: ["Failover", "Lock profile"],
    }),
    list("Features", featuresOf(a), featuresOf(b)),
  ];
}

function head(side: Side, config: DnsConfig, same: boolean): HTMLElement {
  const source = config.source;
  const card = tag(
    "div",
    "compare-head",
    tag("span", "compare-head__side", side),
    tag(
      "strong",
      "compare-head__name",
      config.name.trim() === "" ? "Unnamed configuration" : config.name,
    ),
    tag(
      "span",
      "compare-head__sub",
      source === undefined ? "Not saved yet" : breakable(
        source.edited === true ? `${source.file} (edited)` : source.file,
      ),
    ),
  );
  if (source?.profileId !== undefined) {
    card.append(
      tag("span", "compare-head__sub mono", breakable(source.profileId)),
    );
  }
  if (source?.sha256 !== undefined) {
    const hash = tag(
      "span",
      "compare-head__sub mono",
      "SHA-256 ",
      tag("span", same ? "hash" : "", shortHash(source.sha256)),
    );
    hash.title = source.sha256;
    card.append(hash);
  }
  return card;
}

function filter(total: number, differences: number): HTMLElement {
  const button = (only: boolean, ...label: (Node | string)[]) => {
    const node = tag("button", "compare-filter__btn", ...label);
    (node as HTMLButtonElement).type = "button";
    node.dataset["only"] = String(only);
    return node;
  };
  const count = (value: number) =>
    tag("span", "compare-filter__count", String(value));
  if (differences === 0) {
    return tag(
      "div",
      "compare-filter compare-filter--none",
      tag("p", "compare-filter__none", `No differences in ${total} fields`),
      button(false, `Show all ${total}`),
    );
  }
  const group = tag(
    "div",
    "compare-filter",
    button(false, "All ", count(total)),
    button(true, "Only differences ", count(differences)),
  );
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Show");
  return group;
}

function status(field: Field): HTMLElement[] {
  return field.differs && field.detail !== undefined
    ? [tag("p", "compare-detail", field.detail)]
    : [];
}

function cards(
  a: DnsConfig,
  b: DnsConfig,
  fields: readonly Field[],
  filterBar: HTMLElement,
): HTMLElement {
  const same = sameFile(a, b);
  const view = tag(
    "div",
    "compare-cards",
    tag("div", "compare-cards__heads", head("A", a, same), head("B", b, same)),
    filterBar,
  );
  const who = (side: Side) => tag("span", "compare-who", side);
  for (const field of fields) {
    let body: HTMLElement;
    if (field.slots !== undefined) {
      body = field.slots.length === 0 ? none() : tag(
        "div",
        "compare-slots",
        tag("div", "compare-slot compare-slot--head", who("A"), who("B")),
        ...field.slots.map((slot) =>
          tag(
            "div",
            slot.a === slot.b ? "compare-slot" : "compare-slot is-different",
            tag("span", "compare-slot__label", slot.label),
            tag("span", "compare-slot__a mono", slot.a ?? "–"),
            tag("span", "compare-slot__b mono", slot.b ?? "–"),
          )
        ),
      );
    } else {
      body = tag(
        "div",
        field.long === true
          ? "compare-pair compare-pair--long"
          : "compare-pair",
        tag("div", "compare-val", who("A"), field.a!()),
        tag("div", "compare-val", who("B"), field.b!()),
      );
    }
    const section = tag(
      "section",
      "compare-field",
      tag(
        "header",
        "compare-field__head",
        tag(
          "div",
          "",
          tag("h3", "compare-field__label", field.label),
          ...status(field),
        ),
        tag(
          "span",
          "compare-field__badge",
          field.differs ? "Different" : "Same",
        ),
      ),
      body,
    );
    section.dataset["differs"] = String(field.differs);
    view.append(section);
  }
  return view;
}

function table(
  a: DnsConfig,
  b: DnsConfig,
  fields: readonly Field[],
  filterBar: HTMLElement,
): HTMLElement {
  const grid = tag("table", "compare__table");
  const same = sameFile(a, b);
  const column = (side: Side, config: DnsConfig) => {
    const th = tag("th", "", head(side, config, same));
    th.setAttribute("scope", "col");
    return th;
  };
  grid.append(
    tag(
      "thead",
      "",
      tag("tr", "", tag("td", ""), column("A", a), column("B", b)),
    ),
  );
  const label = (field: Field) => {
    const th = tag(
      "th",
      "compare__label",
      tag("span", "compare__label-name", field.label),
    );
    th.setAttribute("scope", "row");
    if (field.differs) th.append(hidden(", different"), ...status(field));
    return th;
  };
  for (const field of fields) {
    const group = tag("tbody", "compare__field");
    group.dataset["differs"] = String(field.differs);
    if (field.slots !== undefined && field.slots.length > 0) {
      field.slots.forEach((slot, index) => {
        const cell = (value: string | undefined) =>
          tag(
            "td",
            "",
            tag("span", "compare__slot-tag", slot.label),
            value === undefined
              ? tag("span", "compare-none", "–", hidden("not set"))
              : tag("span", "mono", value),
          );
        const row = tag(
          "tr",
          slot.a === slot.b ? "compare__slot" : "compare__slot is-different",
        );
        if (index === 0) {
          const th = label(field);
          th.setAttribute("rowspan", String(field.slots!.length));
          row.append(th);
        }
        row.append(cell(slot.a), cell(slot.b));
        group.append(row);
      });
    } else {
      group.append(
        tag(
          "tr",
          "",
          label(field),
          tag("td", "", field.a?.() ?? none()),
          tag("td", "", field.b?.() ?? none()),
        ),
      );
    }
    grid.append(group);
  }
  return tag("div", "compare__wide", filterBar, grid);
}

export interface CompareOptions {
  /** What a card that was never saved gets: the Download panel's choice. */
  readonly unsavedFormat: ProfileFormat;
  readonly onlyDifferences: boolean;
  readonly onFilter: (onlyDifferences: boolean) => void;
}

/** Cards on phones and tablets, a table from 768px and in the app. */
export function compareViews(
  a: DnsConfig,
  b: DnsConfig,
  options: CompareOptions,
): { element: HTMLElement; differences: number } {
  const fields = fieldsOf(a, b, options.unsavedFormat);
  const differences = fields.filter((field) => field.differs).length;
  const views = tag(
    "div",
    "compare-views",
    cards(a, b, fields, filter(fields.length, differences)),
    table(a, b, fields, filter(fields.length, differences)),
  );
  const show = (onlyDifferences: boolean) => {
    views.classList.toggle("compare-views--differences", onlyDifferences);
    for (
      const button of views.querySelectorAll<HTMLElement>(
        ".compare-filter__btn",
      )
    ) {
      button.setAttribute(
        "aria-pressed",
        String((button.dataset["only"] === "true") === onlyDifferences),
      );
    }
  };
  views.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLElement>(
      ".compare-filter__btn",
    );
    if (button === null) return;
    const onlyDifferences = button.dataset["only"] === "true";
    show(onlyDifferences);
    options.onFilter(onlyDifferences);
  });
  show(options.onlyDifferences || differences === 0);
  return { element: views, differences };
}
