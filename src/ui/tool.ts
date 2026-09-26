/**
 * Entry point for the tool page (`index.html`).
 */

import { appConfig, type DnsPreset } from "../config.ts";
import {
  configProblems,
  hasProblems,
  parseLines,
  parseList,
  serverError,
} from "../lib/validate.ts";
import type { DnsConfig, DnsProtocol } from "../lib/types.ts";
import { element, input, setFieldError, showNotices, textarea } from "./dom.ts";
import { enableDrop, readProfileFile, uploadError } from "./dropzone.ts";
import { browserStorage, createConfigStore, persist } from "./storage.ts";
import { enableThemeSwitch } from "./theme.ts";

const store = createConfigStore(browserStorage());

const form = element<HTMLFormElement>("mainForm");
const submit = input("btn_addToProfile");
const dropzone = element("dropzone");
const uploadStatus = element("uploadStatus");
const uploadHint = uploadStatus.textContent;
const uploadNotice = element<HTMLUListElement>("uploadNotice");
const serverCheck = element("serverCheck");
const serverCheckText = element("serverCheckText");
const presetList = element("presets");

/** The stored configuration the form is editing, if any. */
let editing: DnsConfig | undefined;

function readForm(): DnsConfig {
  const supplementalMatchDomains = parseList(input("matchDomains").value);
  return {
    name: input("provName").value.trim(),
    protocol: selectedProtocol(),
    serverUrl: input("serverUrl").value.trim(),
    serverAddresses: parseList(textarea("serverAddresses").value),
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
  input(config.protocol === "HTTPS" ? "doh" : "dot").checked = true;
  input("serverUrl").value = config.serverUrl;
  textarea("serverAddresses").value = config.serverAddresses.join("\n");
  // Reveal imported addresses rather than hiding them in the collapsed section.
  if (config.serverAddresses.length > 0) {
    element<HTMLDetailsElement>("disclosure-serverAddresses").open = true;
  }
  textarea("exclWifi").value = config.excludedWifi.join("\n");
  input("exclDomains").value = config.excludedDomains.join(", ");
  input("matchDomains").value = (config.supplementalMatchDomains ?? [])
    .join(", ");
  input("useWifi").checked = config.useWifi;
  input("useCell").checked = config.useCellular;
  input("useEthernet").checked = config.useEthernet;
  input("allowFailover").checked = config.allowFailover === true;
  input("lockProfile").checked = config.prohibitDisablement;
  applyProtocol();
}

function selectedProtocol(): DnsProtocol {
  return input("doh").checked ? "HTTPS" : "TLS";
}

function applyProtocol(): void {
  const doh = input("doh").checked;
  element("dohdotServerLabel").textContent = doh ? "DoH URL" : "DoT hostname";
  input("serverUrl").placeholder = doh
    ? "https://example.com/dns-query"
    : "dot.example.com";
  updateServerCheck();
  syncPresets();
}

/**
 * Turns the shield in the server field into a green check once the value is
 * usable. Only ever reassures: a mistake is reported on submit, and cleared
 * here as soon as it is fixed.
 */
function updateServerCheck(): void {
  const protocol = selectedProtocol();
  const valid = serverError(protocol, input("serverUrl").value.trim()) ===
    null;
  serverCheck.classList.toggle("input-check--valid", valid);
  serverCheckText.textContent = valid
    ? protocol === "HTTPS" ? "Valid DoH server URL." : "Valid DoT server name."
    : "";
  if (valid) setFieldError(element("field-serverUrl"), null);
}

/**
 * Whether the form holds exactly `preset`, addresses included: once the user
 * edits any of them, it is their configuration rather than the preset.
 */
function matchesPreset(preset: DnsPreset): boolean {
  const addresses = parseList(textarea("serverAddresses").value);
  const expected = preset.serverAddresses ?? [];
  return input("provName").value.trim() === preset.name &&
    selectedProtocol() === preset.protocol &&
    input("serverUrl").value.trim() === preset.serverUrl &&
    addresses.length === expected.length &&
    addresses.every((address, i) => address === expected[i]);
}

function syncPresets(): void {
  appConfig.presets.forEach((preset, index) => {
    presetList.children[index]?.setAttribute(
      "aria-pressed",
      String(matchesPreset(preset)),
    );
  });
}

function applyPreset(preset: DnsPreset): void {
  const addresses = textarea("serverAddresses");
  const hasAddresses = addresses.value.trim() !== "";
  const blank = input("provName").value.trim() === "" &&
    input("serverUrl").value.trim() === "" && !hasAddresses;
  // Switching from one untouched preset to another loses nothing, so only
  // ask when the fields hold something the user entered.
  const untouched = blank || appConfig.presets.some(matchesPreset);
  if (
    !untouched &&
    !confirm(
      `Replace the provider name and server with ${preset.name}?` +
        (hasAddresses ? " The resolver addresses will be replaced." : ""),
    )
  ) {
    return;
  }

  const presetAddresses = preset.serverAddresses ?? [];
  input("provName").value = preset.name;
  input(preset.protocol === "HTTPS" ? "doh" : "dot").checked = true;
  input("serverUrl").value = preset.serverUrl;
  // Always replaced, never kept: addresses from another provider would point
  // the profile at the wrong resolver.
  addresses.value = presetAddresses.join("\n");
  if (presetAddresses.length > 0) {
    element<HTMLDetailsElement>("disclosure-serverAddresses").open = true;
  }
  setFieldError(element("field-provName"), null);
  setFieldError(element("field-serverAddresses"), null);
  applyProtocol();
}

/**
 * Switching protocol away from a loaded preset clears its server, since a
 * preset's server only speaks the preset's protocol (all DoH at the moment),
 * and leaving the URL in place would just fail the DoT check.
 */
function changeProtocol(): void {
  const name = input("provName").value.trim();
  const server = input("serverUrl");
  const leftPreset = appConfig.presets.some((preset) =>
    preset.name === name &&
    preset.serverUrl === server.value.trim() &&
    preset.protocol !== selectedProtocol()
  );
  if (leftPreset) server.value = "";
  applyProtocol();
}

/**
 * The chips themselves are rendered by the build (`presetChips` in
 * `scripts/build.ts`), one per preset in the same order, so they are in
 * place at first paint instead of shifting the form down.
 */
function bindPresets(): void {
  appConfig.presets.forEach((preset, index) => {
    presetList.children[index]?.addEventListener(
      "click",
      () => applyPreset(preset),
    );
  });
  // An empty group would leave a stray label on the page.
  presetList.closest<HTMLElement>(".field")?.toggleAttribute(
    "hidden",
    appConfig.presets.length === 0,
  );
}

/**
 * Validates at the input, where a mistake can actually be reported. The rules
 * themselves live in `configProblems`, shared with the profile page.
 */
function validate(config: DnsConfig): boolean {
  const problems = configProblems(config);
  setFieldError(element("field-provName"), problems.name ?? null);
  setFieldError(element("field-serverUrl"), problems.serverUrl ?? null);
  setFieldError(
    element("field-serverAddresses"),
    problems.serverAddresses ?? null,
  );
  setFieldError(element("field-exclWifi"), problems.excludedWifi ?? null);
  return !hasProblems(problems);
}

/**
 * Confirms which file filled the form, or restores the hint when `name` is
 * null. `#uploadStatus` is a live region, so the change is also announced.
 */
function showLoaded(name: string | null): void {
  dropzone.classList.toggle("zone--loaded", name !== null);
  if (name === null) {
    uploadStatus.textContent = uploadHint;
    return;
  }
  const file = document.createElement("strong");
  file.textContent = name;
  file.title = name;
  // The status row is a flex line spaced by `gap`, which collapses this space
  // visually; it is kept so assistive tech does not read "Loadedfoo".
  uploadStatus.replaceChildren("Loaded ", file);
}

async function handleUpload(file: File): Promise<void> {
  const uploadField = element("field-fileupload");
  let configs: DnsConfig[];
  let warnings: string[];
  try {
    ({ configs, warnings } = await readProfileFile(file));
  } catch (error) {
    showLoaded(null);
    showNotices(uploadNotice, []);
    setFieldError(uploadField, uploadError(error));
    return;
  }

  setFieldError(uploadField, null);

  const [only] = configs;
  if (configs.length === 1 && only !== undefined) {
    writeForm(only);
    showLoaded(file.name);
    showNotices(uploadNotice, warnings);
    // Point at anything the profile got wrong now, not on the first submit.
    validate(readForm());
    return;
  }

  // Several at once go straight to the list, where the profile page marks
  // any that need fixing and holds back the download until they are.

  const saved = persist(() => {
    store.add(...configs);
    // Shown by the profile page, since this one is about to be left.
    store.setImportWarnings(warnings);
  });
  if (saved) location.href = "finalize.html";
}

function init(): void {
  enableThemeSwitch(element<HTMLButtonElement>("themeSwitch"));
  bindPresets();

  for (const id of ["doh", "dot"]) {
    input(id).addEventListener("change", changeProtocol);
  }
  input("provName").addEventListener("input", syncPresets);
  textarea("serverAddresses").addEventListener("input", syncPresets);
  input("serverUrl").addEventListener("input", () => {
    updateServerCheck();
    syncPresets();
  });

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

  editing = store.takeEditTarget();
  if (editing !== undefined) {
    writeForm(editing);
    submit.value = "Save changes";
    // Usually reached through "Fix" on a flagged card, so show why at once.
    validate(readForm());
  }

  applyProtocol();
}

init();
