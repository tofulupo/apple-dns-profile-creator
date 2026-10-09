import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import type { SigningIdentity } from "../../src/desktop/bindings.ts";
import { optionLabel } from "../../src/ui/signing.ts";

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
