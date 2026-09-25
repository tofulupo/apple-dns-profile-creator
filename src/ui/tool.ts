/**
 * Entry point for the tool page (`index.html`).
 */

import { appConfig, type DnsPreset } from "../config.ts";
import { isIPv4, isIPv6, parseList, serverError } from "../lib/validate.ts";
import type { DnsConfig, DnsProtocol } from "../lib/types.ts";
import { element, input, setFieldError, textarea } from "./dom.ts";
import { enableDrop, readProfileFile, uploadError } from "./dropzone.ts";
import { createConfigStore } from "./storage.ts";

const store = createConfigStore(localStorage);

const form = element<HTMLFormElement>("mainForm");
const submit = input("btn_addToProfile");
const dropzone = element("dropzone");
const uploadStatus = element("uploadStatus");
const uploadHint = uploadStatus.textContent;
const serverCheck = element("serverCheck");
const serverCheckText = element("serverCheckText");
const presetList = element("presets");

let editIndex: number | undefined;

function readForm(): DnsConfig {
  const supplementalMatchDomains = parseList(input("matchDomains").value);
  return {
    name: input("provName").value.trim(),
    protocol: input("doh").checked ? "HTTPS" : "TLS",
    serverUrl: input("serverUrl").value.trim(),
    serverAddresses: parseList(textarea("serverAddresses").value),
    excludedWifi: parseList(input("exclWifi").value),
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
  input("exclWifi").value = config.excludedWifi.join(", ");
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
  element("dohdotServerLabel").textContent = doh
    ? "DoH server URL"
    : "DoT server name";
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

function matchesPreset(preset: DnsPreset): boolean {
  return input("provName").value.trim() === preset.name &&
    selectedProtocol() === preset.protocol &&
    input("serverUrl").value.trim() === preset.serverUrl;
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
    input("serverUrl").value.trim() === "";
  // Switching from one untouched preset to another loses nothing, so only
  // ask when the fields hold something the user entered.
  const untouched = !hasAddresses &&
    (blank || appConfig.presets.some(matchesPreset));
  if (
    !untouched &&
    !confirm(
      `Replace the provider name and server with ${preset.name}?` +
        (hasAddresses ? " The resolver addresses will be cleared." : ""),
    )
  ) {
    return;
  }

  input("provName").value = preset.name;
  input(preset.protocol === "HTTPS" ? "doh" : "dot").checked = true;
  input("serverUrl").value = preset.serverUrl;
  // A preset names its server only; addresses from another provider would
  // point the profile at the wrong resolver.
  addresses.value = "";
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

function renderPresets(): void {
  presetList.replaceChildren(
    ...appConfig.presets.map((preset) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = preset.name;
      chip.setAttribute("aria-pressed", "false");
      chip.addEventListener("click", () => applyPreset(preset));
      return chip;
    }),
  );
  // An empty group would leave a stray label on the page.
  presetList.closest<HTMLElement>(".field")?.toggleAttribute(
    "hidden",
    appConfig.presets.length === 0,
  );
}

/**
 * Validates at the input, where a mistake can actually be reported.
 */
function validate(config: DnsConfig): boolean {
  let ok = true;

  const nameField = element("field-provName");
  if (config.name === "") {
    setFieldError(nameField, "Give the provider a name.");
    ok = false;
  } else {
    setFieldError(nameField, null);
  }

  const serverMessage = serverError(config.protocol, config.serverUrl);
  setFieldError(element("field-serverUrl"), serverMessage);
  if (serverMessage !== null) ok = false;

  const addressField = element("field-serverAddresses");
  const invalid = config.serverAddresses.filter(
    (address) => !isIPv4(address) && !isIPv6(address),
  );
  if (invalid.length > 0) {
    setFieldError(
      addressField,
      `Not valid IP addresses: ${invalid.join(", ")}`,
    );
    ok = false;
  } else {
    setFieldError(addressField, null);
  }

  return ok;
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
  try {
    configs = await readProfileFile(file);
  } catch (error) {
    showLoaded(null);
    setFieldError(uploadField, uploadError(error));
    return;
  }

  setFieldError(uploadField, null);

  if (configs.length === 1) {
    writeForm(configs[0] as DnsConfig);
    showLoaded(file.name);
    return;
  }

  for (const config of configs) {
    store.add(config);
  }
  location.href = "finalize.html";
}

function init(): void {
  renderPresets();

  for (const id of ["doh", "dot"]) {
    input(id).addEventListener("change", changeProtocol);
  }
  input("provName").addEventListener("input", syncPresets);
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

    if (editIndex === undefined) {
      store.add(config);
    } else {
      store.replace(editIndex, config);
    }
    location.href = "finalize.html";
  });

  editIndex = store.takeEditIndex();
  if (editIndex !== undefined) {
    const existing = store.list()[editIndex];
    if (existing === undefined) {
      editIndex = undefined;
    } else {
      writeForm(existing);
      submit.value = "Save changes";
    }
  }

  applyProtocol();
}

init();
