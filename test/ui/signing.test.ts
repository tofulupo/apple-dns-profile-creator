import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import type { SigningIdentity } from "../../src/desktop/bindings.ts";
import {
  chooseSignWith,
  optionLabel,
  SIGN_WITH_KEY,
  signWithChosen,
} from "../../src/ui/signing.ts";
import { moveKeys } from "../../src/ui/storage.ts";

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
  };
}

const IDENTITIES: SigningIdentity[] = [
  { id: "1A2B3C4D5E6F", name: "Office Signing", status: "trusted" },
  { id: "9F8E7D6C5B4A", name: "Office Signing", status: "trusted" },
  { id: "ABCDEF012345", name: "Home", status: "untrusted" },
  { id: "0123456789AB", name: "Work", status: "trusted" },
];

describe("the certificate list", () => {
  it("shows the start of the fingerprint for certificates with the same name", () => {
    expect(optionLabel(IDENTITIES[0]!, IDENTITIES)).toBe(
      "Office Signing \u00b7 1A2B3C4D",
    );
    expect(optionLabel(IDENTITIES[1]!, IDENTITIES)).toBe(
      "Office Signing \u00b7 9F8E7D6C",
    );
  });

  it("says when a certificate isn't trusted", () => {
    expect(optionLabel(IDENTITIES[2]!, IDENTITIES)).toBe(
      "Home \u00b7 not trusted",
    );
  });

  it("shows only the name of a trusted certificate with its own name", () => {
    expect(optionLabel(IDENTITIES[3]!, IDENTITIES)).toBe("Work");
  });
});

// "Forget on quit" says it deletes cards and signing choices: the choice is in
// the page's storage with the cards, and nowhere else.
describe("the signing choice", () => {
  it("is kept in the page's storage, under the same prefix as the cards", () => {
    const storage = memoryStorage();
    chooseSignWith("1A2B3C4D5E6F", storage);
    expect(signWithChosen(storage)).toBe("1A2B3C4D5E6F");
    expect(SIGN_WITH_KEY).toMatch(/^dns-mobileconfig:/);

    const other = memoryStorage();
    moveKeys(storage, other);
    expect(storage.getItem(SIGN_WITH_KEY)).toBeNull();
    expect(signWithChosen(other)).toBe("1A2B3C4D5E6F");
  });

  it("is removed when the profile goes unsigned", () => {
    const storage = memoryStorage();
    chooseSignWith("1A2B3C4D5E6F", storage);
    chooseSignWith(undefined, storage);
    expect(storage.length).toBe(0);
    expect(signWithChosen(storage)).toBeUndefined();
  });

  it("is simply not remembered when storage is blocked", () => {
    const blocked = {
      getItem: (): string | null => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: (): void => {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem: (): void => {
        throw new DOMException("blocked", "SecurityError");
      },
    };
    expect(() => chooseSignWith("1A2B3C4D5E6F", blocked)).not.toThrow();
    expect(signWithChosen(blocked)).toBeUndefined();
  });
});
