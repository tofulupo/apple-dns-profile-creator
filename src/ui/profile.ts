/**
 * Entry point for the profile page (`finalize.html`).
 */

import { appConfig } from "../config.ts";
import { buildProfileXml } from "../lib/profile.ts";
import type { DnsConfig } from "../lib/types.ts";
import { randomUuid } from "../lib/uuid.ts";
import { element, input } from "./dom.ts";
import { downloadProfile } from "./download.ts";
import { createConfigStore } from "./storage.ts";

const store = createConfigStore(localStorage);

const list = element("dynamicList");
const emptyState = element("emptyState");
const downloadButton = element<HTMLButtonElement>("downloadBtn");
const deleteAllButton = element<HTMLButtonElement>("deleteAllBtn");

function row(label: string, value: string, mono = false): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const term = document.createElement("dt");
  term.textContent = label;
  const definition = document.createElement("dd");
  definition.textContent = value;
  if (mono) definition.className = "mono";
  fragment.append(term, definition);
  return fragment;
}

function badge(label: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "badge";
  span.textContent = label;
  return span;
}

function button(
  label: string,
  className: string,
  onClick: () => void,
  ariaLabel?: string,
): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  if (ariaLabel !== undefined) element.setAttribute("aria-label", ariaLabel);
  element.addEventListener("click", onClick);
  return element;
}

function card(config: DnsConfig, index: number): HTMLElement {
  const article = document.createElement("article");
  article.className = "profile-card";

  const header = document.createElement("header");
  header.className = "profile-card__head";

  const title = document.createElement("h3");
  title.className = "profile-card__title";
  title.textContent = config.name;

  const actions = document.createElement("div");
  actions.className = "profile-card__actions";
  actions.append(
    button("Edit", "btn btn--icon", () => {
      store.setEditIndex(index);
      location.href = "index.html";
    }),
    button(
      "\u2715",
      "btn btn--danger btn--icon",
      () => {
        store.remove(index);
        render();
      },
      `Delete ${config.name}`,
    ),
  );

  header.append(title, actions);

  const body = document.createElement("dl");
  body.className = "profile-card__body";
  body.append(
    row(
      "Connection",
      config.protocol === "HTTPS" ? "DNS-over-HTTPS" : "DNS-over-TLS",
    ),
    row("Server", config.serverUrl, true),
  );
  if (config.serverAddresses.length > 0) {
    body.append(row("Resolvers", config.serverAddresses.join(", "), true));
  }
  if (config.excludedWifi.length > 0) {
    body.append(row("Excluded Wi-Fi", config.excludedWifi.join(", ")));
  }
  if (config.excludedDomains.length > 0) {
    body.append(row("Excluded domains", config.excludedDomains.join(", ")));
  }
  const matchDomains = config.supplementalMatchDomains ?? [];
  if (matchDomains.length > 0) {
    body.append(row("Limited to domains", matchDomains.join(", ")));
  }

  const flags = document.createElement("p");
  flags.className = "profile-card__flags";
  if (config.useWifi) flags.append(badge("Wi-Fi"));
  if (config.useCellular) flags.append(badge("Cellular"));
  if (config.useEthernet) flags.append(badge("Ethernet"));
  if (config.allowFailover === true) flags.append(badge("Failover allowed"));
  if (config.prohibitDisablement) flags.append(badge("Disablement prohibited"));

  article.append(header, body);
  if (flags.childElementCount > 0) article.append(flags);
  return article;
}

function render(): void {
  const configs = store.list();

  list.replaceChildren(...configs.map(card));
  emptyState.hidden = configs.length > 0;
  downloadButton.disabled = configs.length === 0;
  deleteAllButton.disabled = configs.length === 0;
}

async function download(): Promise<void> {
  const configs = store.list();
  if (configs.length === 0) return;

  const xml = buildProfileXml(
    configs,
    {
      systemScope: input("systemChk").checked,
      identifierPrefix: appConfig.identifierPrefix,
    },
    // Falls back to crypto.getRandomValues() when
    // crypto.randomUUID() is unavailable, which is the case on a plain http://
    // LAN address.
    randomUuid,
  );

  try {
    await downloadProfile(appConfig.profileFilename, xml);
  } catch (error) {
    alert(
      `Could not save the profile: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function init(): void {
  element("appVersion").textContent = `version ${appConfig.appVersion}`;
  input("systemChk").checked = appConfig.systemScopeByDefault;
  downloadButton.addEventListener("click", download);
  deleteAllButton.addEventListener("click", () => {
    if (!confirm("Delete all configurations on this page?")) return;
    store.clear();
    render();
  });
  render();
}

init();
