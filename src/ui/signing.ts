/**
 * The Signature choice on the profile page: unsigned, or signed with a
 * Keychain identity. Desktop app only; in a browser the section stays hidden
 * and every profile is unsigned.
 */

import type { SigningIdentity } from "../desktop/bindings.ts";
import { element } from "./dom.ts";
import { desktopBindings } from "./download.ts";
import { browserStorage } from "./storage.ts";

/** The identity id last signed with; absent means unsigned. */
const SIGN_WITH_KEY = "dns-mobileconfig:sign-with";

export interface Signing {
  /** The identity id to sign with, or undefined for an unsigned profile. */
  selected(): string | undefined;
}

const STATUS_TEXT: Readonly<Record<SigningIdentity["status"], string>> = {
  trusted: "Trusted on this Mac. Devices that trust its issuer show the " +
    "profile as \u201cVerified\u201d.",
  untrusted: "Not trusted, probably self-signed. Devices show \u201cNot " +
    "Verified\u201d unless this certificate is trusted on them.",
};

function readPreference(): string | undefined {
  try {
    return browserStorage().getItem(SIGN_WITH_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function savePreference(id: string | undefined): void {
  try {
    const storage = browserStorage();
    if (id === undefined) storage.removeItem(SIGN_WITH_KEY);
    else storage.setItem(SIGN_WITH_KEY, id);
  } catch {
    // Not remembering the choice is acceptable; it still applies now.
  }
}

function optionLabel(
  identity: SigningIdentity,
  all: readonly SigningIdentity[],
): string {
  // Renewed certificates keep their name, so repeated names get a short
  // fingerprint to tell them apart.
  const repeated = all.filter((other) => other.name === identity.name)
    .length > 1;
  const parts = [identity.name];
  if (repeated) parts.push(identity.id.slice(0, 8));
  if (identity.status === "untrusted") parts.push("not trusted");
  return parts.join(" \u00b7 ");
}

/**
 * Shows and runs the Signature section in the desktop app. `onChange` is
 * called whenever what `selected()` returns may have changed.
 */
export function enableSigning(onChange: () => void): Signing {
  const bindings = desktopBindings();
  const binding = bindings?.listSigningIdentities;
  if (typeof binding !== "function") return { selected: () => undefined };
  const list: () => Promise<SigningIdentity[]> = binding;

  const section = element<HTMLFieldSetElement>("signing");
  const unsigned = element<HTMLInputElement>("signNone");
  const keychain = element<HTMLInputElement>("signKeychain");
  const keychainHint = element("signKeychainHint");
  const panel = element("identityPanel");
  const select = element<HTMLSelectElement>("identitySelect");
  const status = element("identityStatus");
  const noteUnsigned = element("noteUnsigned");
  const noteSigned = element("noteSigned");

  let identities: SigningIdentity[] = [];
  let failed = false;
  let restored = false;

  function selected(): string | undefined {
    return keychain.checked && select.value !== "" ? select.value : undefined;
  }

  function fillSelect(preferred: string | undefined): void {
    select.replaceChildren(
      ...identities.map((identity) => {
        const option = document.createElement("option");
        option.value = identity.id;
        option.textContent = optionLabel(identity, identities);
        return option;
      }),
    );
    const keep = identities.find((identity) => identity.id === preferred);
    select.value = keep?.id ?? identities[0]?.id ?? "";
  }

  function render(): void {
    keychain.disabled = identities.length === 0;
    if (keychain.disabled) unsigned.checked = true;
    keychainHint.textContent = failed
      ? "Could not read your Keychain."
      : identities.length === 0
      ? "No usable certificate in your Keychain."
      : "Private key stays in your Keychain.";

    const current = identities.find((identity) => identity.id === selected());
    panel.hidden = current === undefined;
    status.textContent = current === undefined
      ? ""
      : STATUS_TEXT[current.status];
    status.className = current === undefined
      ? "identity__status"
      : `identity__status identity__status--${current.status}`;

    noteUnsigned.hidden = current !== undefined;
    noteSigned.hidden = current === undefined;
    onChange();
  }

  async function refresh(): Promise<void> {
    try {
      identities = await list();
      failed = false;
    } catch {
      identities = [];
      failed = true;
    }
    // The first load restores the remembered choice; later ones, after the
    // user may have added or removed certificates, keep the current one.
    const preferred = restored ? select.value : readPreference();
    fillSelect(preferred);
    if (!restored) {
      restored = true;
      if (identities.some((identity) => identity.id === preferred)) {
        keychain.checked = true;
      }
    }
    render();
  }

  function choose(): void {
    savePreference(selected());
    render();
  }

  unsigned.addEventListener("change", choose);
  keychain.addEventListener("change", choose);
  select.addEventListener("change", choose);
  // Picks up certificates added in Keychain Access while the app is open.
  globalThis.addEventListener("focus", () => void refresh());

  section.hidden = false;
  render();
  void refresh();

  return { selected };
}
