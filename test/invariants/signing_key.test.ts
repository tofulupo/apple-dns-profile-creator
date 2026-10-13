import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { linesMatching, rustCode } from "../helpers/scan.ts";

const KEY_EXPORT =
  /SecItemExport|SecKeychainItemExport|SecKeyCopyExternalRepresentation|external_representation|export_pkcs12|\.export\(/;

describe("the signing key never leaves the Keychain", () => {
  it("has no app code that exports a key or identity", () => {
    expect(linesMatching(rustCode(), KEY_EXPORT)).toEqual([]);
  });

  it("would notice a key export", () => {
    expect(KEY_EXPORT.test("let data = key.external_representation()?;"))
      .toBe(true);
    expect(KEY_EXPORT.test("SecItemExport(item, format, 0, ptr::null())"))
      .toBe(true);
  });
});
