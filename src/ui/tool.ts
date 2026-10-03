/**
 * Entry point for the tool page (`index.html`).
 */

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
import { receiveOpenedProfiles } from "./opened.ts";
import { holdStillWhenFitting } from "./overscroll.ts";
import { enablePixelMode } from "./pixel.ts";
import { signalPageReady } from "./page_ready.ts";
import { enableDrop, readProfileFile, uploadError } from "./dropzone.ts";
import { showProfileCount } from "./profile_count.ts";
import { enableSaveMenu, type UpdateSaveMenu } from "./save_menu.ts";
import { browserStorage, createConfigStore, persist } from "./storage.ts";
import { enableThemeSwitch } from "./theme.ts";

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
/** The resolver address fields, in the order their addresses are stored. */
const ipv4Fields = [input("ipv4a"), input("ipv4b")];
const ipv6Fields = [input("ipv6a"), input("ipv6b")];
const addressFields = [...ipv4Fields, ...ipv6Fields];
/** Each family's fields with the group around them and its swap button. */
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

/** A field with a button inside it that opens a menu below it. */
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

/** File > Save (⌘S) in the desktop app, named after the submit button. */
let updateSaveMenu: UpdateSaveMenu = () => {};

function setSubmitLabel(label: string): void {
  submit.textContent = label;
  updateSaveMenu(label, true);
}

/** The stored configuration the form is editing, if any. */
let editing: DnsConfig | undefined;
/**
 * Whether `editing` came from a loaded file rather than from "Fix" on the
 * profile page. Only then does a preset start a new configuration.
 */
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
  // Imports are already cut down to what the fields hold; what is left to
  // drop here comes from entries stored before that.
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
  // Like the addresses: settings that differ from a new configuration's are
  // shown rather than left in the closed section.
  if (updateRules() > 0) rulesDisclosure.open = true;
  applyProtocol();
}

function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Brings the summaries of Behavior & rules up to date, and warns when no
 * interface is left on, which would keep encrypted DNS off everywhere.
 * Returns how many of its rows differ from a new configuration's.
 */
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
  // The warning also shows on the closed section, where the row cannot.
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

/**
 * The quick inserts only make sense for a DoH URL; a DoT server is a bare
 * host name, and gets the note on how easily DoT is blocked in their place.
 * Each insert is disabled while it would change nothing: its part is already
 * there, or, for the path, there is no host yet to follow.
 */
function updateQuickInsert(): void {
  const doh = selectedProtocol() === "HTTPS";
  quickInsert.hidden = !doh;
  protocolNote.hidden = doh;
  // A description is read even while hidden, so the note is only linked
  // while it shows.
  input("serverUrl").setAttribute(
    "aria-describedby",
    doh ? "serverCheckText" : "serverCheckText protocolNote",
  );
  const server = input("serverUrl").value.trim();
  insertScheme.disabled = withHttpsScheme(server) === server;
  insertPath.disabled = withDnsQueryPath(server) === server;
}

/** A quick insert, as an edit ⌘Z can undo. */
function editServer(edit: (server: string) => string): void {
  const server = input("serverUrl");
  server.focus();
  replaceText(server, edit(server.value.trim()));
  onServerInput();
}

function bindQuickInsert(): void {
  for (const button of [insertScheme, insertPath]) {
    // Keeps the focus, and with it the phone keyboard, in the URL field.
    button.addEventListener("pointerdown", (event) => event.preventDefault());
  }
  insertScheme.addEventListener("click", () => editServer(withHttpsScheme));
  insertPath.addEventListener("click", () => editServer(withDnsQueryPath));
}

/** The addresses in the fields, IPv4 first, blanks left out. */
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

/**
 * Fills the address fields from `addresses`, replacing what they held.
 * Returns what did not fit, for `showAddressNotice`.
 */
function writeAddresses(addresses: readonly string[]): string[] {
  const { ipv4, ipv6, dropped } = splitServerAddresses(addresses);
  ipv4Fields.forEach((field, i) => field.value = ipv4[i] ?? "");
  ipv6Fields.forEach((field, i) => field.value = ipv6[i] ?? "");
  for (const field of addressFields) {
    setFieldError(addressFieldOf(field), null);
  }
  // Reveal filled-in addresses rather than hiding them in the closed section.
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

/**
 * Brings the section's summary and buttons up to date with the fields: a
 * remove button on each filled field, a green number on each holding an
 * address of its family, and a swap button where both of a family's fields
 * are filled.
 */
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

/**
 * Rearranges a family's fields: field `i` takes what field `from[i]` held,
 * or is emptied for null. A mistake shown on a field moves with its value.
 * Sets `value` directly, so ⌘Z cannot undo it yet.
 */
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

/** Moves the filled fields of a family up over the empty ones. */
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

/** Why the value of an address field does not belong there, or null. */
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

/**
 * A pasted list (“9.9.9.9, 149.112.112.112”, or one per line) is spread over
 * the fields of its families instead of landing in one field.
 */
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
    // The iOS number pad has a comma rather than a dot in many regions,
    // and a comma never belongs in an IPv4 address. Typed, it becomes a dot
    // before it lands, so ⌘Z undoes the dot in one step.
    field.addEventListener("beforeinput", (event) => {
      const typed = event.inputType === "insertText" ? event.data : null;
      if (!ipv4Fields.includes(field) || !typed?.includes(",")) return;
      event.preventDefault();
      insertText(field, typed.replaceAll(",", "."));
    });
    field.addEventListener("input", (event) => {
      // Commas that came some other way, such as dropped text.
      if (
        ipv4Fields.includes(field) && field.value.includes(",") &&
        !isUndoOrRedo(event)
      ) {
        const caret = field.selectionStart ?? field.value.length;
        replaceText(field, field.value.replaceAll(",", "."), caret);
      }
      // Mistakes are reported on submit, and cleared as soon as they are
      // fixed.
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
        // From the keyboard, the button may just have hidden itself; the
        // field is where the user was working.
        if (document.activeElement === remove) field.focus();
      });
    }
    swap.addEventListener("click", () => rearrangeAddresses(fields, [1, 0]));
    for (const button of [swap, ...fields.map(removeButtonOf)]) {
      // Keeps the focus where it was: in a field, with the phone keyboard
      // open, or nowhere, without opening it.
      button.addEventListener("pointerdown", (event) => event.preventDefault());
    }
    // A field emptied by hand is left alone while the user is still in the
    // pair, so nothing jumps while they type, and closed up after.
    group.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && group.contains(next)) return;
      closeAddressGaps(fields);
    });
  }
}

/**
 * Marks the server field valid, a green check and protocol on its protocol
 * button, once the value is usable. Only ever reassures: a mistake is
 * reported on submit, and cleared here as soon as it is fixed.
 */
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

/**
 * Whether the form holds `preset`'s server and addresses: once the user edits
 * any of them, it is their configuration rather than the preset. The name is
 * left out, since renaming a preset is expected.
 */
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

/** Fills in `preset`. False when the user chose to keep what they had. */
async function applyPreset(preset: DnsPreset): Promise<boolean> {
  const name = input("provName");
  const typedName = name.value.trim();
  // A name the user typed stays; one a preset filled in is replaced.
  const keepName = typedName !== "" &&
    !appConfig.presets.some((other) => other.name === typedName);
  const hasAddresses = formAddresses().length > 0;
  const blank = input("serverUrl").value.trim() === "" && !hasAddresses;
  // Switching from one untouched preset to another loses nothing, so only
  // ask when the fields hold something the user entered.
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
  // Always replaced, never kept: addresses from another provider would point
  // the profile at the wrong resolver.
  showAddressNotice(writeAddresses(preset.serverAddresses ?? []));
  setFieldError(nameField, null);
  // A preset means a new configuration, so it is added next to the loaded
  // file, which stays in the profile as it was, instead of replacing it.
  if (editingLoaded) {
    editing = undefined;
    editingLoaded = false;
    setSubmitLabel(submitLabel);
  }
  applyProtocol();
  return true;
}

/**
 * Switching protocol away from a loaded preset clears its server, since a
 * preset's server only speaks the preset's protocol (all DoH at the moment),
 * and leaving the URL in place would just fail the DoT check.
 */
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

/** Opens or closes `picker`'s menu. Only one is open at a time. */
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
  // The focused entry just disappeared; the button that opened it is where
  // the user was.
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

/**
 * Menus close on a click or tap anywhere outside their field. Not on focus
 * loss: Safari does not focus buttons it taps, so that would close the menu
 * mid-tap.
 */
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
 * The menu entries themselves are rendered by the build (`presetOptions` in
 * `scripts/build.ts`), one per preset in the same order, so they are in
 * place at first paint.
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

/**
 * Validates at the input, where a mistake can actually be reported. The rules
 * themselves live in `configProblems`, shared with the profile page.
 */
function validate(config: DnsConfig): boolean {
  const problems = configProblems(config);
  setFieldError(nameField, problems.name ?? null);
  setFieldError(element("field-serverUrl"), problems.serverUrl ?? null);
  // Stricter than `problems.serverAddresses`, which only knows the list: each
  // field also has to hold its own family.
  let addressesValid = true;
  for (const field of addressFields) {
    const message = addressError(field);
    setFieldError(addressFieldOf(field), message);
    if (message !== null) addressesValid = false;
  }
  setFieldError(element("field-exclWifi"), problems.excludedWifi ?? null);
  return !hasProblems(problems) && addressesValid;
}

/** What happened to a loaded file's configuration. */
type LoadOutcome = "added" | "duplicate" | "unsaved";

/**
 * Confirms which file filled the form, or restores the hint when `name` is
 * null. `#uploadStatus` is a live region, so the change is also announced.
 */
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
  // The status row is a flex line spaced by `gap`, which collapses these
  // spaces visually; they are kept so assistive tech does not run words
  // together.
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

/**
 * Loads a chosen, dropped or opened profile. Resolves with false when it
 * leaves for the profile page, which happens for several configurations.
 */
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
    // Saved at once, so switching to the profile page does not lose it, and
    // then edited like an entry opened from there: changes update it. The
    // profile page flags it if it needs fixing, and holds back the download.
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
    // Point at anything the profile got wrong now, not on the first submit.
    validate(readForm());
    return true;
  }

  // Several at once go straight to the list, where the profile page marks
  // any that need fixing and holds back the download until they are.

  const saved = persist(() => {
    store.add(...configs);
    // Shown by the profile page, since this one is about to be left.
    store.setImportWarnings(warnings);
  });
  if (!saved) return true;
  location.href = "finalize.html";
  return false;
}

function init(): void {
  enableThemeSwitch(element<HTMLButtonElement>("themeSwitch"));
  enablePixelMode();
  // Only in the app, where fields should behave like native ones; a browser
  // page is expected to leave Escape alone.
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
    // Cleared so that choosing the same file again still fires `change`.
    fileInput.value = "";
    if (file !== undefined) void handleUpload(file);
  });

  enableDrop(dropzone, (file) => void handleUpload(file));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const config = readForm();
    if (!validate(config)) return;

    const original = editing;
    const saved = persist(() => {
      if (original === undefined) store.add(config);
      else store.update(original, config);
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
    // Usually reached through "Fix" on a flagged card, so show why at once.
    validate(readForm());
  }

  applyProtocol();
  updateSaveMenu(submit.textContent ?? "", true);
}

init();
holdStillWhenFitting();
signalPageReady();
void receiveOpenedProfiles(handleUpload);
