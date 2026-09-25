/**
 * Entry point for the tool page (`index.html`).
 */

import { parseProfileXml } from "../lib/import.ts";
import { isIPv4, isIPv6, parseList } from "../lib/validate.ts";
import type { DnsConfig } from "../lib/types.ts";
import { element, input, setFieldError, textarea } from "./dom.ts";
import { createConfigStore } from "./storage.ts";

const store = createConfigStore(localStorage);

const form = element<HTMLFormElement>("mainForm");
const submit = input("btn_addToProfile");

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

function applyProtocol(): void {
  const doh = input("doh").checked;
  element("dohdotServerLabel").textContent = doh
    ? "DoH server URL"
    : "DoT server name";
  input("serverUrl").placeholder = doh
    ? "https://example.com/dns-query"
    : "dot.example.com";
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

  const serverField = element("field-serverUrl");
  if (config.serverUrl === "") {
    setFieldError(serverField, "A server address is required.");
    ok = false;
  } else if (
    config.protocol === "HTTPS" && !/^https:\/\/.+/.test(config.serverUrl)
  ) {
    setFieldError(serverField, "A DoH server must be an https:// URL.");
    ok = false;
  } else if (config.protocol === "TLS" && config.serverUrl.includes(":")) {
    setFieldError(
      serverField,
      "Custom ports are not supported for DoT. Remove the “:” part.",
    );
    ok = false;
  } else {
    setFieldError(serverField, null);
  }

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

async function handleUpload(file: File): Promise<void> {
  const uploadField = element("field-fileupload");
  try {
    const configs = parseProfileXml(await file.text());

    if (configs.length === 0) {
      setFieldError(uploadField, "That profile contains no DNS settings.");
      return;
    }

    setFieldError(uploadField, null);

    if (configs.length === 1) {
      writeForm(configs[0] as DnsConfig);
      return;
    }

    for (const config of configs) {
      store.add(config);
    }
    location.href = "finalize.html";
  } catch (error) {
    setFieldError(
      uploadField,
      error instanceof Error ? error.message : "Could not read that file.",
    );
  }
}

function init(): void {
  for (const id of ["doh", "dot"]) {
    input(id).addEventListener("change", applyProtocol);
  }

  element<HTMLInputElement>("fileupload").addEventListener(
    "change",
    (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file !== undefined) void handleUpload(file);
    },
  );

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
