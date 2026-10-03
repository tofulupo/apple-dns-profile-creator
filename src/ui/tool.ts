import { appConfig, type DnsPreset } from "../config.ts";
import {
  orderServerAddresses,
  splitServerAddresses,
} from "../lib/addresses.ts";
import {
  configProblems,
  hasProblems,
  isIPv4,
  isIPv6,
  parseLines,
  parseList,
  serverError,
  stripDotScheme,
  withDnsQueryPath,
  withHttpsScheme,
} from "../lib/validate.ts";
import type { DnsConfig, DnsProtocol } from "../lib/types.ts";
import {
  element,
  input,
  setFieldError,
  setFieldValid,
  showNotices,
  textarea,
} from "./dom.ts";

import { ask } from "./dialogs.ts";
import { desktopBindings } from "./desktop.ts";
import {
  enableEscapeRevert,
  insertText,
  isUndoOrRedo,
  replaceText,
} from "./editing.ts";
import { enableMascot } from "./mascot.ts";
import { receiveOpenedProfiles } from "./opened.ts";
import { holdStillWhenFitting } from "./overscroll.ts";
import { enablePixelMode } from "./pixel.ts";
import { signalPageReady } from "./page_ready.ts";
import { enableDrop, readProfileFile, uploadError } from "./dropzone.ts";
import { showProfileCount } from "./profile_count.ts";
import { enableSaveMenu, type UpdateSaveMenu } from "./save_menu.ts";
import { enableSettings } from "./settings.ts";
import { browserStorage, createConfigStore, persist } from "./storage.ts";
import { enableThemeSwitch } from "./theme.ts";
import { watchKeyboard } from "./dock.ts";

const store = createConfigStore(browserStorage());

const form = element<HTMLFormElement>("mainForm");
const submitButton = element<HTMLButtonElement>("btn_addToProfile");
const submit = element("addToProfileLabel");
const dropzone = element("dropzone");
const uploadStatus = element("uploadStatus");
const uploadHint = uploadStatus.textContent;
const uploadNotice = element<HTMLUListElement>("uploadNotice");

const serverCheckText = element("serverCheckText");
const nameField = element("field-provName");
const presetToggle = element<HTMLButtonElement>("presetToggle");
const presetMenu = element<HTMLUListElement>("presetMenu");
const presetButtons = [
  ...presetMenu.querySelectorAll<HTMLButtonElement>("button.preset"),
];
const serverField = element("field-serverUrl");
const protocolToggle = element<HTMLButtonElement>("protocolToggle");
const protocolToggleText = element("protocolToggleText");
const protocolMenu = element<HTMLUListElement>("protocolMenu");
const protocolButtons = [
  ...protocolMenu.querySelectorAll<HTMLButtonElement>("button.preset"),
];
const protocolNote = element("protocolNote");
const quickInsert = element("quickInsert");
const insertScheme = element<HTMLButtonElement>("insertScheme");
const insertPath = element<HTMLButtonElement>("insertPath");
const addressDisclosure = element<HTMLDetailsElement>(
  "disclosure-serverAddresses",
);
const addressCount = element("addressCount");
const rulesDisclosure = element<HTMLDetailsElement>("disclosure-rules");
const rulesSummary = element("rulesSummary");
const wifiSummary = element("wifiSummary");
const domainSummary = element("domainSummary");
const interfacesWarning = element("interfacesWarning");
const interfaceChecks = [
  input("useWifi"),
  input("useCell"),
  input("useEthernet"),
];
const addressNotice = element<HTMLUListElement>("addressNotice");
const ipv4Fields = [input("ipv4a"), input("ipv4b")];
const ipv6Fields = [input("ipv6a"), input("ipv6b")];
const addressFields = [...ipv4Fields, ...ipv6Fields];
const addressPairs = [
  {
    fields: ipv4Fields,
    group: element("addressesIpv4"),
    swap: element<HTMLButtonElement>("swapIpv4"),
  },
  {
    fields: ipv6Fields,
    group: element("addressesIpv6"),
    swap: element<HTMLButtonElement>("swapIpv6"),
  },
];
const submitLabel = submit.textContent ?? "";

interface Picker {
  field: HTMLElement;
  toggle: HTMLButtonElement;
  menu: HTMLElement;
}

const presetPicker: Picker = {
  field: nameField,
  toggle: presetToggle,
  menu: presetMenu,
};
const protocolPicker: Picker = {
  field: serverField,
  toggle: protocolToggle,
  menu: protocolMenu,
};
const pickers = [presetPicker, protocolPicker];

let protocol: DnsProtocol = "HTTPS";

let updateSaveMenu: UpdateSaveMenu = () => {};

function setSubmitLabel(label: string): void {
  submit.textContent = label;
  updateSaveMenu(label, true);
}

let editing: DnsConfig | undefined;
let editingLoaded = false;

function readForm(): DnsConfig {
  const supplementalMatchDomains = parseList(input("matchDomains").value);
  return {
    name: input("provName").value.trim(),
    protocol: selectedProtocol(),
    serverUrl: input("serverUrl").value.trim(),
    serverAddresses: formAddresses(),
    excludedWifi: parseLines(textarea("exclWifi").value),
    excludedDomains: parseList(input("exclDomains").value),
    useWifi: input("useWifi").checked,
    useCellular: input("useCell").checked,
    useEthernet: input("useEthernet").checked,
    prohibitDisablement: input("lockProfile").checked,
    ...(input("allowFailover").checked && { allowFailover: true }),
    ...(supplementalMatchDomains.length > 0 && { supplementalMatchDomains }),
  };
}

function writeForm(config: DnsConfig): void {
  input("provName").value = config.name;
  protocol = config.protocol;
  input("serverUrl").value = config.serverUrl;
  showAddressNotice(writeAddresses(config.serverAddresses));
  textarea("exclWifi").value = config.excludedWifi.join("\n");
  input("exclDomains").value = config.excludedDomains.join(", ");
  input("matchDomains").value = (config.supplementalMatchDomains ?? [])
    .join(", ");
  input("useWifi").checked = config.useWifi;
  input("useCell").checked = config.useCellular;
  input("useEthernet").checked = config.useEthernet;
  input("allowFailover").checked = config.allowFailover === true;
  input("lockProfile").checked = config.prohibitDisablement;
  if (updateRules() > 0) rulesDisclosure.open = true;
  applyProtocol();
}

function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function updateRules(): number {
  const networks = parseLines(textarea("exclWifi").value).length;
  wifiSummary.textContent = networks === 0
    ? "None"
    : countLabel(networks, "network", "networks");

  const skipped = parseList(input("exclDomains").value).length;
  const only = parseList(input("matchDomains").value).length;
  const domainParts = [
    ...(skipped > 0 ? [`Skip ${skipped}`] : []),
    ...(only > 0 ? [`Only ${only}`] : []),
  ];
  domainSummary.textContent = domainParts.length === 0
    ? "None"
    : domainParts.join(" · ");

  const interfacesOn = interfaceChecks.filter((check) => check.checked).length;
  const noInterface = interfacesOn === 0;
  interfacesWarning.hidden = !noInterface;

  const changed = [
    networks > 0,
    skipped + only > 0,
    interfacesOn < interfaceChecks.length,
    input("allowFailover").checked,
    input("lockProfile").checked,
  ].filter((differs) => differs).length;
  rulesSummary.classList.toggle("panel-disclosure__meta--warning", noInterface);
  rulesSummary.textContent = noInterface
    ? "No interface on"
    : changed === 0
    ? "Defaults"
    : `${changed} changed`;
  return changed;
}

function bindRules(): void {
  for (const id of ["exclDomains", "matchDomains"]) {
    input(id).addEventListener("input", updateRules);
  }
  textarea("exclWifi").addEventListener("input", updateRules);
  for (
    const check of [
      ...interfaceChecks,
      input("allowFailover"),
      input("lockProfile"),
    ]
  ) {
    check.addEventListener("change", updateRules);
  }
}

function selectedProtocol(): DnsProtocol {
  return protocol;
}

function applyProtocol(): void {
  const doh = protocol === "HTTPS";
  element("dohdotServerLabel").textContent = doh ? "DoH URL" : "DoT hostname";
  input("serverUrl").placeholder = doh
    ? "https://example.com/dns-query"
    : "dot.example.com";
  protocolToggleText.textContent = doh ? "DoH" : "DoT";
  for (const button of protocolButtons) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset["protocol"] === protocol),
    );
  }
  updateServerCheck();
  updateQuickInsert();
  syncPresets();
}

function onServerInput(event?: Event): void {
  const server = input("serverUrl");
  if (
    selectedProtocol() === "TLS" &&
    (event === undefined || !isUndoOrRedo(event))
  ) {
    replaceText(server, stripDotScheme(server.value));
  }
  updateServerCheck();
  updateQuickInsert();
  syncPresets();
}

function updateQuickInsert(): void {
  const doh = selectedProtocol() === "HTTPS";
  quickInsert.hidden = !doh;
  protocolNote.hidden = doh;
  input("serverUrl").setAttribute(
    "aria-describedby",
    doh ? "serverCheckText" : "serverCheckText protocolNote",
  );
  const server = input("serverUrl").value.trim();
  insertScheme.disabled = withHttpsScheme(server) === server;
  insertPath.disabled = withDnsQueryPath(server) === server;
}

function editServer(edit: (server: string) => string): void {
  const server = input("serverUrl");
  server.focus();
  replaceText(server, edit(server.value.trim()));
  onServerInput();
}

function bindQuickInsert(): void {
  for (const button of [insertScheme, insertPath]) {
    button.addEventListener("pointerdown", (event) => event.preventDefault());
  }
  insertScheme.addEventListener("click", () => editServer(withHttpsScheme));
  insertPath.addEventListener("click", () => editServer(withDnsQueryPath));
}

function formAddresses(): string[] {
  return addressFields
    .map((field) => field.value.trim())
    .filter((address) => address !== "");
}

function addressFieldOf(field: HTMLInputElement): HTMLElement {
  const wrapper = field.closest<HTMLElement>(".field");
  if (wrapper === null) throw new Error(`#${field.id} is not in a .field`);
  return wrapper;
}

function writeAddresses(addresses: readonly string[]): string[] {
  const { ipv4, ipv6, dropped } = splitServerAddresses(addresses);
  ipv4Fields.forEach((field, i) => field.value = ipv4[i] ?? "");
  ipv6Fields.forEach((field, i) => field.value = ipv6[i] ?? "");
  for (const field of addressFields) {
    setFieldError(addressFieldOf(field), null);
  }
  if (ipv4.length + ipv6.length > 0) addressDisclosure.open = true;
  updateAddresses();
  return dropped;
}

function quoteList(values: readonly string[]): string {
  return values.map((value) => `“${value}”`).join(", ");
}

function showAddressNotice(dropped: readonly string[]): void {
  const isAddress = (entry: string) => isIPv4(entry) || isIPv6(entry);
  const extra = dropped.filter(isAddress);
  const invalid = dropped.filter((entry) => !isAddress(entry));
  const messages: string[] = [];
  if (extra.length > 0) {
    messages.push(
      `Left out ${
        quoteList(extra)
      }: there are fields for two IPv4 and two IPv6 addresses.`,
    );
  }
  if (invalid.length > 0) {
    messages.push(`Left out ${quoteList(invalid)}: not IP addresses.`);
  }
  showNotices(addressNotice, messages);
  if (messages.length > 0) addressDisclosure.open = true;
}

function removeButtonOf(field: HTMLInputElement): HTMLButtonElement {
  const button = addressFieldOf(field).querySelector<HTMLButtonElement>(
    ".address-input__remove",
  );
  if (button === null) throw new Error(`#${field.id} has no remove button`);
  return button;
}

function updateAddresses(): void {
  const count = formAddresses().length;
  addressCount.textContent = count === 0
    ? "None"
    : count === 1
    ? "1 address"
    : `${count} addresses`;
  for (const field of addressFields) {
    const address = field.value.trim();
    const remove = removeButtonOf(field);
    remove.hidden = address === "";
    remove.setAttribute("aria-label", `Remove ${address}`);
    setFieldValid(
      addressFieldOf(field),
      address !== "" && addressError(field) === null,
    );
  }
  for (const { fields, swap } of addressPairs) {
    swap.classList.toggle(
      "address-swap--idle",
      fields.some((field) => field.value.trim() === ""),
    );
  }
}

function rearrangeAddresses(
  fields: readonly HTMLInputElement[],
  from: readonly (number | null)[],
): void {
  const values = fields.map((field) => field.value);
  const invalid = fields.map((field) =>
    addressFieldOf(field).classList.contains("field--invalid")
  );
  fields.forEach((field, i) => {
    const source = from[i] ?? null;
    field.value = source === null ? "" : values[source] ?? "";
    setFieldError(
      addressFieldOf(field),
      source !== null && invalid[source] ? addressError(field) : null,
    );
  });
  updateAddresses();
  syncPresets();
}

function closeAddressGaps(fields: readonly HTMLInputElement[]): void {
  const filled = fields.flatMap((field, i) =>
    field.value.trim() === "" ? [] : [i]
  );
  if (filled.every((source, i) => source === i)) return;
  rearrangeAddresses(
    fields,
    fields.map((_, i) => filled[i] ?? null),
  );
}

function addressError(field: HTMLInputElement): string | null {
  const address = field.value.trim();
  if (address === "") return null;
  if (ipv4Fields.includes(field)) {
    if (isIPv4(address)) return null;
    return isIPv6(address)
      ? "This is an IPv6 address. It goes in an IPv6 field below."
      : "Not an IPv4 address, such as 192.0.2.1.";
  }
  if (isIPv6(address)) return null;
  return isIPv4(address)
    ? "This is an IPv4 address. It goes in an IPv4 field above."
    : "Not an IPv6 address, such as 2001:db8::1.";
}

function pasteAddresses(event: ClipboardEvent): void {
  const text = event.clipboardData?.getData("text") ?? "";
  const entries = parseList(text.replace(/\s+/g, ","));
  if (entries.length < 2) return;
  const { ipv4, ipv6, dropped } = splitServerAddresses(entries);
  if (ipv4.length + ipv6.length === 0) return;

  event.preventDefault();
  if (ipv4.length > 0) {
    ipv4Fields.forEach((field, i) => field.value = ipv4[i] ?? "");
  }
  if (ipv6.length > 0) {
    ipv6Fields.forEach((field, i) => field.value = ipv6[i] ?? "");
  }
  for (const field of addressFields) {
    if (addressError(field) === null) {
      setFieldError(addressFieldOf(field), null);
    }
  }
  showAddressNotice(dropped);
  updateAddresses();
  syncPresets();
}

function bindAddressFields(): void {
  for (const field of addressFields) {
    field.addEventListener("paste", pasteAddresses);
    field.addEventListener("beforeinput", (event) => {
      const typed = event.inputType === "insertText" ? event.data : null;
      if (!ipv4Fields.includes(field) || !typed?.includes(",")) return;
      event.preventDefault();
      insertText(field, typed.replaceAll(",", "."));
    });
    field.addEventListener("input", (event) => {
      if (
        ipv4Fields.includes(field) && field.value.includes(",") &&
        !isUndoOrRedo(event)
      ) {
        const caret = field.selectionStart ?? field.value.length;
        replaceText(field, field.value.replaceAll(",", "."), caret);
      }
      if (addressError(field) === null) {
        setFieldError(addressFieldOf(field), null);
      }
      updateAddresses();
      syncPresets();
    });
  }

  for (const { fields, group, swap } of addressPairs) {
    for (const field of fields) {
      const remove = removeButtonOf(field);
      remove.addEventListener("click", () => {
        const index = fields.indexOf(field);
        const rest = fields.flatMap((_, i) => i === index ? [] : [i]);
        rearrangeAddresses(fields, fields.map((_, i) => rest[i] ?? null));
        if (document.activeElement === remove) field.focus();
      });
    }
    swap.addEventListener("click", () => rearrangeAddresses(fields, [1, 0]));
    for (const button of [swap, ...fields.map(removeButtonOf)]) {
      button.addEventListener("pointerdown", (event) => event.preventDefault());
    }
    group.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && group.contains(next)) return;
      closeAddressGaps(fields);
    });
  }
}

function updateServerCheck(): void {
  const protocol = selectedProtocol();
  const valid = serverError(protocol, input("serverUrl").value.trim()) ===
    null;
  setFieldValid(serverField, valid);
  serverCheckText.textContent = valid
    ? protocol === "HTTPS" ? "Valid DoH server URL." : "Valid DoT server name."
    : "";
  if (valid) setFieldError(serverField, null);
}

function matchesPreset(preset: DnsPreset): boolean {
  const addresses = formAddresses();
  const expected = orderServerAddresses(preset.serverAddresses ?? []);
  return selectedProtocol() === preset.protocol &&
    input("serverUrl").value.trim() === preset.serverUrl &&
    addresses.length === expected.length &&
    addresses.every((address, i) => address === expected[i]);
}

function syncPresets(): void {
  appConfig.presets.forEach((preset, index) => {
    presetButtons[index]?.setAttribute(
      "aria-pressed",
      String(matchesPreset(preset)),
    );
  });
}

async function applyPreset(preset: DnsPreset): Promise<boolean> {
  const name = input("provName");
  const typedName = name.value.trim();
  const keepName = typedName !== "" &&
    !appConfig.presets.some((other) => other.name === typedName);
  const hasAddresses = formAddresses().length > 0;
  const blank = input("serverUrl").value.trim() === "" && !hasAddresses;
  const untouched = blank || appConfig.presets.some(matchesPreset);
  if (
    !untouched &&
    !await ask(
      (keepName
        ? `Replace the server with ${preset.name}? The name you entered stays.`
        : `Replace the provider name and server with ${preset.name}?`) +
        (hasAddresses ? " The resolver addresses will be replaced." : ""),
    )
  ) {
    return false;
  }

  if (!keepName) name.value = preset.name;
  protocol = preset.protocol;
  input("serverUrl").value = preset.serverUrl;
  showAddressNotice(writeAddresses(preset.serverAddresses ?? []));
  setFieldError(nameField, null);
  if (editingLoaded) {
    editing = undefined;
    editingLoaded = false;
    setSubmitLabel(submitLabel);
  }
  applyProtocol();
  return true;
}

function changeProtocol(next: DnsProtocol): void {
  if (next === protocol) return;
  protocol = next;
  const server = input("serverUrl");
  const leftPreset = appConfig.presets.some((preset) =>
    preset.serverUrl === server.value.trim() &&
    preset.protocol !== selectedProtocol()
  );
  if (leftPreset) server.value = "";
  applyProtocol();
}

function setMenuOpen(picker: Picker, open: boolean): void {
  if (open) {
    for (const other of pickers) {
      if (other !== picker) setMenuOpen(other, false);
    }
  }
  picker.menu.hidden = !open;
  picker.toggle.setAttribute("aria-expanded", String(open));
}

function closeMenu(picker: Picker): void {
  const hadFocus = picker.menu.contains(document.activeElement);
  setMenuOpen(picker, false);
  if (hadFocus) picker.toggle.focus();
}

function bindPicker(picker: Picker): void {
  picker.toggle.addEventListener(
    "click",
    () => setMenuOpen(picker, picker.toggle.ariaExpanded !== "true"),
  );
  picker.field.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || picker.menu.hidden) return;
    event.preventDefault();
    closeMenu(picker);
  });
}

function bindPickers(): void {
  for (const picker of pickers) bindPicker(picker);
  document.addEventListener("pointerdown", (event) => {
    for (const picker of pickers) {
      if (
        !picker.menu.hidden && event.target instanceof Node &&
        !picker.field.contains(event.target)
      ) {
        setMenuOpen(picker, false);
      }
    }
  });
}

/**
 * The buttons come from `presetOptions` in `scripts/build.ts`, one per
 * preset in the same order.
 */
function bindPresets(): void {
  appConfig.presets.forEach((preset, index) => {
    presetButtons[index]?.addEventListener("click", async () => {
      if (await applyPreset(preset)) closeMenu(presetPicker);
    });
  });
  presetToggle.hidden = appConfig.presets.length === 0;
}

function bindProtocols(): void {
  for (const button of protocolButtons) {
    button.addEventListener("click", () => {
      changeProtocol(button.dataset["protocol"] === "TLS" ? "TLS" : "HTTPS");
      closeMenu(protocolPicker);
    });
  }
}

function validate(config: DnsConfig): boolean {
  const problems = configProblems(config);
  setFieldError(nameField, problems.name ?? null);
  setFieldError(element("field-serverUrl"), problems.serverUrl ?? null);
  let addressesValid = true;
  for (const field of addressFields) {
    const message = addressError(field);
    setFieldError(addressFieldOf(field), message);
    if (message !== null) addressesValid = false;
  }
  setFieldError(element("field-exclWifi"), problems.excludedWifi ?? null);
  return !hasProblems(problems) && addressesValid;
}

type LoadOutcome = "added" | "duplicate" | "unsaved";

function showLoaded(name: null): void;
function showLoaded(name: string, outcome: LoadOutcome): void;
function showLoaded(name: string | null, outcome?: LoadOutcome): void {
  dropzone.classList.toggle("zone--loaded", name !== null);
  if (name === null) {
    uploadStatus.textContent = uploadHint;
    return;
  }
  const file = document.createElement("strong");
  file.textContent = name;
  file.title = name;
  switch (outcome) {
    case "added":
      uploadStatus.replaceChildren("Added ", file, " to profile");
      break;
    case "duplicate":
      uploadStatus.replaceChildren("Already in profile: ", file);
      break;
    case "unsaved":
      uploadStatus.replaceChildren("Loaded ", file);
      break;
  }
}

function updateProfileCount(): void {
  showProfileCount(store.list().length);
}

async function handleUpload(file: File): Promise<boolean> {
  const uploadField = element("field-fileupload");
  let configs: DnsConfig[];
  let warnings: string[];
  try {
    ({ configs, warnings } = await readProfileFile(file));
  } catch (error) {
    showLoaded(null);
    showNotices(uploadNotice, []);
    setFieldError(uploadField, uploadError(error));
    return true;
  }

  setFieldError(uploadField, null);

  const [only] = configs;
  if (configs.length === 1 && only !== undefined) {
    const duplicate = store.has(only);
    const saved = duplicate || persist(() => store.add(only));
    editing = saved ? only : undefined;
    editingLoaded = saved;
    updateProfileCount();
    setSubmitLabel(saved ? "Save changes" : submitLabel);
    writeForm(only);
    showLoaded(
      file.name,
      duplicate ? "duplicate" : saved ? "added" : "unsaved",
    );
    showNotices(uploadNotice, warnings);
    validate(readForm());
    return true;
  }

  const saved = persist(() => {
    store.add(...configs);
    store.setImportWarnings(warnings);
  });
  if (!saved) return true;
  location.href = "finalize.html";
  return false;
}

function init(): void {
  enableSettings();
  enableThemeSwitch(element<HTMLButtonElement>("themeSwitch"));
  watchKeyboard();
  enablePixelMode();
  enableMascot();
  if (desktopBindings() !== undefined) enableEscapeRevert();
  updateSaveMenu = enableSaveMenu(() => form.requestSubmit(submitButton));
  bindPickers();
  bindPresets();
  bindProtocols();
  bindQuickInsert();
  bindAddressFields();
  bindRules();

  input("serverUrl").addEventListener("input", onServerInput);

  const fileInput = input("fileupload");
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file !== undefined) void handleUpload(file);
  });

  enableDrop(dropzone, (file) => void handleUpload(file));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const config = readForm();
    if (!validate(config)) return;

    const original = editing;
    const next = original?.fromDeprecatedPayload === true
      ? { ...config, fromDeprecatedPayload: true }
      : config;
    const saved = persist(() => {
      if (original === undefined) store.add(next);
      else store.update(original, next);
    });
    if (saved) location.href = "finalize.html";
  });

  updateProfileCount();
  updateAddresses();
  updateRules();
  store.subscribe(updateProfileCount);

  editing = store.takeEditTarget();
  if (editing !== undefined) {
    writeForm(editing);
    setSubmitLabel("Save changes");
    validate(readForm());
  }

  applyProtocol();
  updateSaveMenu(submit.textContent ?? "", true);
}

init();
holdStillWhenFitting();
signalPageReady();
void receiveOpenedProfiles(handleUpload);
