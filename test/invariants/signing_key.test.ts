import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { files, linesMatching } from "../helpers/scan.ts";

describe("the signing key never leaves the Keychain", () => {
  it("has no app code that exports a key or identity", () => {
    expect(
      linesMatching(
        files("src-tauri/src", [".rs"]),
        /SecItemExport|SecKeychainItemExport|SecKeyCopyExternalRepresentation|external_representation|export_pkcs12|\.export\(/,
      ),
    ).toEqual([]);
  });
});
