import { appConfig } from "../config.ts";
import { buildProfileXml } from "../lib/profile.ts";
import type { DnsConfig, ProfileFormat } from "../lib/types.ts";
import { randomUuid } from "../lib/uuid.ts";
import { configProblems, isIPv4, isIPv6 } from "../lib/validate.ts";
import { element, input, setFieldError, showNotices } from "./dom.ts";

import { ask, tell } from "./dialogs.ts";
import { desktopBindings } from "./desktop.ts";
import { enableMascot } from "./mascot.ts";
import { receiveOpenedProfiles } from "./opened.ts";
import { holdStillWhenFitting } from "./overscroll.ts";
import { enablePixelMode } from "./pixel.ts";
import { signalPageReady } from "./page_ready.ts";
import {
  canShareProfile,
  downloadProfile,
  shareProfile,
  shareProfileInApp,
} from "./download.ts";
import { showProfileCount } from "./profile_count.ts";
import { enableDrop, readProfileFile, uploadError } from "./dropzone.ts";
import {
  enableSaveMenu,
  enableShareMenu,
  type UpdateSaveMenu,
} from "./save_menu.ts";
import { enableSettings } from "./settings.ts";
import { enableSigning, type Signing } from "./signing.ts";
import { browserStorage, createConfigStore, persist } from "./storage.ts";
import { enableThemeSwitch } from "./theme.ts";
import { watchKeyboard } from "./dock.ts";

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
const shareButton = element<HTMLButtonElement>("shareBtn");
const canShare = canShareProfile(appConfig.profileFilename);
const sharesInApp = canShare && desktopBindings() !== undefined;

let signing: Signing = { selected: () => undefined };

let updateSaveMenu: UpdateSaveMenu = () => {};
let updateShareMenu: (enabled: boolean) => void = () => {};

function syncSaveMenu(): void {
  updateSaveMenu(
    downloadLabel.textContent ?? "",
    !downloadPanel.hidden && !downloadButton.disabled,
  );
  updateShareMenu(
    !downloadPanel.hidden && !shareButton.hidden && !shareButton.disabled,
  );
}

function updateDownloadButton(): void {
  const signed = signing.selected() !== undefined;
  downloadLabel.textContent = signed
    ? "Download signed profile"
    : canShare
    ? "Download"
    : "Download profile";
  downloadIcon.classList.toggle("icon--shield-check", signed);
  downloadIcon.classList.toggle("icon--file-download", !signed);
  syncSaveMenu();
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

function resolverRow(addresses: readonly string[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const term = document.createElement("dt");
  term.textContent = "Resolvers";
  const definition = document.createElement("dd");
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
  definition.append(list);
  fragment.append(term, definition);
  return fragment;
}

function badge(label: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "badge";
  span.textContent = label;
  return span;
}

const DEPRECATED_EXPLANATION =
  "Loaded from the classic DNS payload, deprecated in iOS 27 and macOS 27";

function deprecatedBadge(): HTMLSpanElement {
  const span = badge("Deprecated");
  span.classList.add("badge--warning");
  span.title = DEPRECATED_EXPLANATION;
  const explanation = document.createElement("span");
  explanation.className = "visually-hidden";
  explanation.textContent = `: ${DEPRECATED_EXPLANATION}`;
  span.append(explanation);
  return span;
}

function icon(name: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `icon icon--${name}`;
  span.setAttribute("aria-hidden", "true");
  return span;
}

function button(
  content: string | Node,
  className: string,
  onClick: () => void,
  ariaLabel?: string,
): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.replaceChildren(content);
  if (ariaLabel !== undefined) element.setAttribute("aria-label", ariaLabel);
  element.addEventListener("click", onClick);
  return element;
}

function editConfig(config: DnsConfig): void {
  if (persist(() => store.startEdit(config))) {
    location.href = "./";
  }
}

function deleteConfig(config: DnsConfig): void {
  persist(() => store.remove(config));
  render();
}

let cardMenuFor: DnsConfig | undefined;

function enableCardMenu(
  article: HTMLElement,
  config: DnsConfig,
  fix: boolean,
): void {
  const showCardMenu = desktopBindings()?.showCardMenu;
  if (typeof showCardMenu !== "function") return;
  let hadSelection = false;
  article.addEventListener("mousedown", (event) => {
    const selection = getSelection();
    hadSelection = selection !== null && !selection.isCollapsed &&
      event.target instanceof Node &&
      selection.containsNode(event.target, true);
  });
  article.addEventListener("contextmenu", (event) => {
    if (hadSelection) return;
    event.preventDefault();
    getSelection()?.removeAllRanges();
    cardMenuFor = config;
    showCardMenu(fix).catch((error) =>
      console.error("Could not show the card's menu:", error)
    );
  });
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

  const title = document.createElement("h3");
  title.className = "profile-card__title";
  title.textContent = label;

  const actions = document.createElement("div");
  actions.className = "profile-card__actions";
  actions.append(
    button(
      problems.length > 0 ? "Fix" : "Edit",
      "btn btn--icon",
      () => editConfig(config),
      `${problems.length > 0 ? "Fix" : "Edit"} ${label}`,
    ),
    button(
      icon("close"),
      "btn btn--danger btn--icon",
      () => deleteConfig(config),
      `Delete ${label}`,
    ),
  );
  enableCardMenu(article, config, problems.length > 0);

  header.append(title, actions);
  article.append(header);

  if (problems.length > 0) {
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
      config.protocol === "HTTPS" ? "DNS over HTTPS" : "DNS over TLS",
    ),
    row("Server", config.serverUrl, true),
  );
  if (config.serverAddresses.length > 0) {
    body.append(resolverRow(config.serverAddresses));
  }
  if (config.excludedWifi.length > 0) {
    body.append(
      row(
        "Skip for SSID",
        config.excludedWifi.map((ssid) => `“${ssid}”`).join(", "),
        true,
      ),
    );
  }
  if (config.excludedDomains.length > 0) {
    body.append(
      row("Skip for domains", config.excludedDomains.join(", "), true),
    );
  }
  const matchDomains = config.supplementalMatchDomains ?? [];
  if (matchDomains.length > 0) {
    body.append(row("Only for domains", matchDomains.join(", "), true));
  }

  const flags = document.createElement("p");
  flags.className = "profile-card__flags";
  if (config.fromDeprecatedPayload === true) flags.append(deprecatedBadge());
  if (config.useWifi) flags.append(badge("Wi-Fi"));
  if (config.useCellular) flags.append(badge("Cellular"));
  if (config.useEthernet) flags.append(badge("Ethernet"));
  if (config.allowFailover === true) flags.append(badge("Failover"));
  if (config.prohibitDisablement) flags.append(badge("Lock profile"));

  article.append(body);
  if (flags.childElementCount > 0) article.append(flags);
  return article;
}

function render(): void {
  const configs = store.list();

  const count = configs.length;

  list.replaceChildren(...configs.map(card));
  showProfileCount(count);
  const number = document.createElement("strong");
  number.textContent = String(count);
  configCount.replaceChildren(
    number,
    count === 1 ? " configuration" : " configurations",
  );
  deleteAllButton.hidden = count < 2;
  emptyState.hidden = count > 0;
  configList.hidden = count === 0;
  downloadPanel.hidden = count === 0;

  const invalid = configs.filter((config) => problemsOf(config).length > 0)
    .length;
  downloadButton.disabled = saving || invalid > 0;
  shareButton.disabled = saving || invalid > 0;
  downloadBlocked.hidden = invalid === 0;
  downloadBlocked.textContent = invalid === 0
    ? ""
    : `Fix ${
      invalid === 1 ? "the configuration" : `the ${invalid} configurations`
    } marked above before ${
      canShare ? "downloading or sharing" : "downloading"
    }.`;
  syncSaveMenu();
  updateDeclarationsNote();
}

function updateDeclarationsNote(): void {
  element("declarationsNote").hidden = input("declarationsChk").checked ||
    !store.list().some((config) => config.fromDeprecatedPayload === true);
}

function clearDeprecatedMarks(): void {
  persist(() => {
    for (const config of store.list()) {
      if (config.fromDeprecatedPayload !== true) continue;
      const { fromDeprecatedPayload: _mark, ...settings } = config;
      store.update(config, settings);
    }
  });
}

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

let saving = false;

function profileXml(format: ProfileFormat): string | undefined {
  const configs = store.list();
  if (configs.length === 0 || configs.some((c) => problemsOf(c).length > 0)) {
    render();
    return undefined;
  }
  return buildProfileXml(
    configs,
    {
      systemScope: input("systemChk").checked,
      identifierPrefix: appConfig.identifierPrefix,
      format,
    },
    randomUuid,
  );
}

function selectedFormat(): ProfileFormat {
  return input("declarationsChk").checked ? "declarations" : "payload";
}

async function download(): Promise<void> {
  if (saving) return;
  const format = selectedFormat();
  const xml = profileXml(format);
  if (xml === undefined) return;

  saving = true;
  downloadButton.disabled = true;
  shareButton.disabled = true;
  syncSaveMenu();
  try {
    const signWith = signing.selected();
    await downloadProfile(
      signWith === undefined
        ? appConfig.profileFilename
        : appConfig.signedProfileFilename,
      xml,
      signWith,
    );
    if (format === "declarations") clearDeprecatedMarks();
  } catch (error) {
    await tell(
      `Could not save the profile: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    saving = false;
    render();
  }
}

async function share(): Promise<void> {
  if (saving) return;
  const format = selectedFormat();
  const xml = profileXml(format);
  if (xml === undefined) return;

  saving = true;
  downloadButton.disabled = true;
  shareButton.disabled = true;
  syncSaveMenu();
  try {
    if (sharesInApp) {
      const signWith = signing.selected();
      await shareProfileInApp(
        signWith === undefined
          ? appConfig.profileFilename
          : appConfig.signedProfileFilename,
        xml,
        signWith,
        shareButton.getBoundingClientRect(),
      );
    } else {
      const shared = await shareProfile(appConfig.profileFilename, xml);
      if (shared && format === "declarations") clearDeprecatedMarks();
    }
  } catch (error) {
    await tell(
      `Could not share the profile: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    saving = false;
    render();
  }
}

function bindDeclarationFormat(): void {
  const system = input("systemChk");
  const declarations = input("declarationsChk");
  let chosenScope = system.checked;
  declarations.addEventListener("change", () => {
    if (declarations.checked) {
      chosenScope = system.checked;
      system.checked = true;
    } else {
      system.checked = chosenScope;
    }
    system.disabled = declarations.checked;
    updateDeclarationsNote();
  });
}

function init(): void {
  enableSettings();
  enableThemeSwitch(element<HTMLButtonElement>("themeSwitch"));
  watchKeyboard();
  enablePixelMode();
  enableMascot();
  updateSaveMenu = enableSaveMenu(() => void download());
  updateShareMenu = enableShareMenu(() => void share());
  desktopBindings()?.onCardMenuChosen?.((action) => {
    const config = cardMenuFor;
    cardMenuFor = undefined;
    if (config === undefined) return;
    if (action === "edit") editConfig(config);
    else deleteConfig(config);
  }).catch((error) => console.error("Could not listen for card menus:", error));
  input("systemChk").checked = appConfig.systemScopeByDefault;
  bindDeclarationFormat();
  signing = enableSigning(updateDownloadButton);
  downloadButton.addEventListener("click", () => void download());
  shareButton.hidden = !canShare;
  shareButton.addEventListener("click", () => void share());
  updateDownloadButton();
  enableDrop(emptyZone, (file) => void importFile(file));
  deleteAllButton.addEventListener("click", async () => {
    if (!await ask("Delete all configurations on this page?")) return;
    persist(() => store.clear());
    showNotices(importNotice, []);
    render();
  });
  store.subscribe(render);
  showNotices(importNotice, store.takeImportWarnings());
  render();
}

init();
holdStillWhenFitting();
signalPageReady();
void receiveOpenedProfiles(importFile);
