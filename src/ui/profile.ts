/**
 * Entry point for the profile page (`finalize.html`).
 */

import { appConfig } from "../config.ts";
import { buildProfileXml } from "../lib/profile.ts";
import type { DnsConfig } from "../lib/types.ts";
import { randomUuid } from "../lib/uuid.ts";
import { configProblems } from "../lib/validate.ts";
import { element, input, setFieldError, showNotices } from "./dom.ts";
import { downloadProfile } from "./download.ts";
import { enableDrop, readProfileFile, uploadError } from "./dropzone.ts";
import { enableSigning, type Signing } from "./signing.ts";
import { browserStorage, createConfigStore, persist } from "./storage.ts";
import { enableThemeSwitch } from "./theme.ts";

const store = createConfigStore(browserStorage());

const list = element("dynamicList");
const emptyState = element("emptyState");
const emptyZone = element("emptyZone");
const configList = element("configList");
const configCount = element("configCount");
const downloadPanel = element("downloadPanel");
const downloadButton = element<HTMLButtonElement>("downloadBtn");
const deleteAllButton = element<HTMLButtonElement>("deleteAllBtn");
const importNotice = element<HTMLUListElement>("importNotice");
const downloadBlocked = element("downloadBlocked");
const downloadLabel = element("downloadLabel");
const downloadIcon = element("downloadIcon");

let signing: Signing = { selected: () => undefined };

function updateDownloadButton(): void {
  const signed = signing.selected() !== undefined;
  downloadLabel.textContent = signed
    ? "Download signed profile"
    : "Download profile";
  downloadIcon.hidden = !signed;
}

function problemsOf(config: DnsConfig): string[] {
  return Object.values(configProblems(config));
}

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

function card(config: DnsConfig): HTMLElement {
  const problems = problemsOf(config);
  const label = config.name.trim() === ""
    ? "Unnamed configuration"
    : config.name;

  const article = document.createElement("article");
  article.className = problems.length > 0
    ? "profile-card profile-card--invalid"
    : "profile-card";

  const header = document.createElement("header");
  header.className = "profile-card__head";

  // Cards sit under the list's own heading.
  const title = document.createElement("h4");
  title.className = "profile-card__title";
  title.textContent = label;

  const actions = document.createElement("div");
  actions.className = "profile-card__actions";
  actions.append(
    button(
      problems.length > 0 ? "Fix" : "Edit",
      "btn btn--icon",
      () => {
        if (persist(() => store.startEdit(config))) {
          location.href = "index.html";
        }
      },
      `${problems.length > 0 ? "Fix" : "Edit"} ${label}`,
    ),
    button(
      "\u2715",
      "btn btn--danger btn--icon",
      () => {
        persist(() => store.remove(config));
        render();
      },
      `Delete ${label}`,
    ),
  );

  header.append(title, actions);
  article.append(header);

  if (problems.length > 0) {
    // Imported and stored entries never went through the form's checks, so
    // this is where their mistakes surface.
    const problemList = document.createElement("ul");
    problemList.className = "profile-card__problems";
    problemList.setAttribute("aria-label", `Problems with ${label}`);
    problemList.append(
      ...problems.map((problem) => {
        const item = document.createElement("li");
        item.textContent = problem;
        return item;
      }),
    );
    article.append(problemList);
  }

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
    // Quoted, since a network name can contain the comma between them.
    body.append(
      row(
        "Excluded Wi-Fi",
        config.excludedWifi.map((ssid) => `“${ssid}”`).join(", "),
      ),
    );
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

  article.append(body);
  if (flags.childElementCount > 0) article.append(flags);
  return article;
}

function render(): void {
  const configs = store.list();

  const count = configs.length;

  list.replaceChildren(...configs.map(card));
  configCount.textContent = `${count} ${
    count === 1 ? "configuration" : "configurations"
  }`;
  // With nothing to download or delete, only the empty state is shown.
  emptyState.hidden = count > 0;
  configList.hidden = count === 0;
  downloadPanel.hidden = count === 0;

  const invalid = configs.filter((config) => problemsOf(config).length > 0)
    .length;
  downloadButton.disabled = saving || invalid > 0;
  downloadBlocked.hidden = invalid === 0;
  downloadBlocked.textContent = invalid === 0
    ? ""
    : `Fix ${
      invalid === 1 ? "the configuration" : `the ${invalid} configurations`
    } marked above before downloading.`;
}

/**
 * Adds every configuration in a dropped profile straight to the list. Unlike
 * the tool page there is no form to review a single one in first.
 */
async function importFile(file: File): Promise<void> {
  let configs: DnsConfig[];
  let warnings: string[];
  try {
    ({ configs, warnings } = await readProfileFile(file));
  } catch (error) {
    showNotices(importNotice, []);
    setFieldError(emptyState, uploadError(error));
    return;
  }

  setFieldError(emptyState, null);
  if (!persist(() => store.add(...configs))) return;
  showNotices(importNotice, warnings);
  render();
}

/**
 * True while a download is in progress. In the desktop app that includes the
 * Deno-side dialogs, and a second click would queue a second save.
 */
let saving = false;

async function download(): Promise<void> {
  if (saving) return;
  const configs = store.list();
  // Re-checked here rather than trusting the button: another tab may have
  // changed the list since it was last rendered.
  if (configs.length === 0 || configs.some((c) => problemsOf(c).length > 0)) {
    render();
    return;
  }

  saving = true;
  downloadButton.disabled = true;
  try {
    const xml = buildProfileXml(
      configs,
      {
        systemScope: input("systemChk").checked,
        identifierPrefix: appConfig.identifierPrefix,
      },
      // Falls back to crypto.getRandomValues() when
      // crypto.randomUUID() is unavailable, which is the case on a plain
      // http:// LAN address.
      randomUuid,
    );
    const signWith = signing.selected();
    await downloadProfile(
      signWith === undefined
        ? appConfig.profileFilename
        : appConfig.signedProfileFilename,
      xml,
      signWith,
    );
  } catch (error) {
    alert(
      `Could not save the profile: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    saving = false;
    render();
  }
}

function init(): void {
  enableThemeSwitch(element<HTMLButtonElement>("themeSwitch"));
  input("systemChk").checked = appConfig.systemScopeByDefault;
  signing = enableSigning(updateDownloadButton);
  downloadButton.addEventListener("click", () => void download());
  enableDrop(emptyZone, (file) => void importFile(file));
  deleteAllButton.addEventListener("click", () => {
    if (!confirm("Delete all configurations on this page?")) return;
    persist(() => store.clear());
    showNotices(importNotice, []);
    render();
  });
  // Keeps this list in step with edits and deletions made in another tab,
  // since Download saves whatever is stored, not what is on screen.
  store.subscribe(render);
  // Left by the tool page when a multi-configuration upload sent us here.
  showNotices(importNotice, store.takeImportWarnings());
  render();
}

init();
