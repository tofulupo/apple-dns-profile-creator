/**
 * Tests for Keychain signing, with `security` replaced by recorded output.
 * Nothing here touches a real keychain.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  createKeychain,
  type KeychainIdentity,
  parseFindCertificate,
  parseFindIdentity,
  type RunResult,
  usableIdentities,
} from "../../src/desktop/signing.ts";
import { WITH_SKI, WITHOUT_SKI } from "../helpers/certificates.ts";

const A = "A".repeat(40);
const B = "B".repeat(40);
const C = "C".repeat(40);

/** The shape `security find-identity -p basic` prints on macOS. */
const FIND_IDENTITY = `
Policy: X.509 Basic
  Matching identities
  1) ${A} "me@example.com" (CSSMERR_TP_CERT_EXPIRED)
  2) ${WITH_SKI.sha1} ".mobileconfig" (CSSMERR_TP_NOT_TRUSTED)
  3) ${B} "Company Signing"
  4) ${WITHOUT_SKI.sha1} "Legacy \\"quoted\\" name" (CSSMERR_TP_NOT_TRUSTED)
     4 identities found

  Valid identities only
  1) ${B} "Company Signing"
     1 valid identities found
`;

const FIND_CERTIFICATE = `SHA-256 hash: ${"0".repeat(64)}
SHA-1 hash: ${WITH_SKI.sha1}
${WITH_SKI.pem}
SHA-256 hash: ${"1".repeat(64)}
SHA-1 hash: ${WITHOUT_SKI.sha1}
${WITHOUT_SKI.pem}
`;

describe("parseFindIdentity", () => {
  it("reads every identity once, with macOS's verdict", () => {
    expect(parseFindIdentity(FIND_IDENTITY)).toEqual([
      { sha1: A, name: "me@example.com", error: "CSSMERR_TP_CERT_EXPIRED" },
      {
        sha1: WITH_SKI.sha1,
        name: ".mobileconfig",
        error: "CSSMERR_TP_NOT_TRUSTED",
      },
      { sha1: B, name: "Company Signing" },
      {
        sha1: WITHOUT_SKI.sha1,
        name: 'Legacy \\"quoted\\" name',
        error: "CSSMERR_TP_NOT_TRUSTED",
      },
    ]);
  });

  it("finds nothing in an empty keychain", () => {
    expect(parseFindIdentity("  0 identities found\n")).toEqual([]);
  });
});

describe("parseFindCertificate", () => {
  it("maps each fingerprint to its Subject Key Identifier, if any", () => {
    const keyIds = parseFindCertificate(FIND_CERTIFICATE);
    expect(keyIds.get(WITH_SKI.sha1)).toBe(WITH_SKI.subjectKeyId);
    expect(keyIds.has(WITHOUT_SKI.sha1)).toBe(true);
    expect(keyIds.get(WITHOUT_SKI.sha1)).toBeUndefined();
  });
});

describe("usableIdentities", () => {
  const keyIds = new Map<string, string | undefined>([
    [B, "B0B0"],
    [C, "C0C0"],
  ]);

  it("hides expired, not yet valid and revoked certificates", () => {
    const all: KeychainIdentity[] = [
      { sha1: A, name: "Old", error: "CSSMERR_TP_CERT_EXPIRED" },
      { sha1: B, name: "Future", error: "CSSMERR_TP_CERT_NOT_VALID_YET" },
      { sha1: C, name: "Revoked", error: "CSSMERR_TP_CERT_REVOKED" },
    ];
    expect(usableIdentities(all, keyIds)).toEqual([]);
  });

  it("marks untrusted ones, sorted by name", () => {
    const all: KeychainIdentity[] = [
      { sha1: C, name: "Zeta", error: "CSSMERR_TP_NOT_TRUSTED" },
      { sha1: B, name: "Alpha" },
    ];
    expect(usableIdentities(all, keyIds)).toEqual([
      { id: B, name: "Alpha", status: "trusted", selector: ["-Z", "B0B0"] },
      { id: C, name: "Zeta", status: "untrusted", selector: ["-Z", "C0C0"] },
    ]);
  });

  it("falls back to the name only when it is unique, expired ones included", () => {
    const unique: KeychainIdentity[] = [{ sha1: A, name: "Only one" }];
    expect(usableIdentities(unique, keyIds)[0]?.selector).toEqual([
      "-N",
      "Only one",
    ]);

    // An expired namesake would make `-N` ambiguous, so the identity is left
    // out rather than risk signing with the wrong certificate.
    const clash: KeychainIdentity[] = [
      { sha1: A, name: "Twin" },
      { sha1: "D".repeat(40), name: "Twin", error: "CSSMERR_TP_CERT_EXPIRED" },
    ];
    expect(usableIdentities(clash, keyIds)).toEqual([]);
  });
});

/** A fake `security` that records its calls and answers from a script. */
function fakeSecurity(
  answer: (args: readonly string[], stdin?: Uint8Array) => Partial<RunResult>,
) {
  const calls: { args: readonly string[]; stdin: string | undefined }[] = [];
  const run = (args: readonly string[], stdin?: Uint8Array) => {
    calls.push({
      args,
      stdin: stdin === undefined ? undefined : new TextDecoder().decode(stdin),
    });
    return Promise.resolve({
      success: true,
      stdout: new Uint8Array(),
      stderr: "",
      ...answer(args, stdin),
    });
  };
  return { run, calls };
}

const encode = (text: string) => new TextEncoder().encode(text);
const SIGNED = Uint8Array.of(0x30, 0x82, 0x01, 0x02);

function inventory(args: readonly string[]): Partial<RunResult> | undefined {
  if (args[0] === "find-identity") return { stdout: encode(FIND_IDENTITY) };
  if (args[0] === "find-certificate") {
    return { stdout: encode(FIND_CERTIFICATE) };
  }
  return undefined;
}

describe("createKeychain", () => {
  it("lists usable identities without their selectors", async () => {
    const { run } = fakeSecurity((args) => inventory(args) ?? {});
    // The expired one is hidden; "Company Signing" and the legacy one have no
    // Subject Key Identifier here but unique names, so they stay.
    expect(await createKeychain(run).list()).toEqual([
      { id: WITH_SKI.sha1, name: ".mobileconfig", status: "untrusted" },
      { id: B, name: "Company Signing", status: "trusted" },
      {
        id: WITHOUT_SKI.sha1,
        name: 'Legacy \\"quoted\\" name',
        status: "untrusted",
      },
    ]);
  });

  it("signs through stdin with the Subject Key Identifier, then verifies", async () => {
    const xml = "<plist>profile</plist>";
    const { run, calls } = fakeSecurity((args) =>
      inventory(args) ??
        (args.includes("-S") ? { stdout: SIGNED } : { stdout: encode(xml) })
    );

    const result = await createKeychain(run).sign(xml, WITH_SKI.sha1);

    expect(result).toEqual({ signed: SIGNED, name: ".mobileconfig" });
    const cms = calls.filter((call) => call.args[0] === "cms");
    expect(cms.map((call) => call.args)).toEqual([
      ["cms", "-S", "-G", "-H", "SHA256", "-Z", WITH_SKI.subjectKeyId],
      ["cms", "-D"],
    ]);
    expect(cms[0]?.stdin).toBe(xml);
  });

  it("refuses an id that is not a usable identity, before signing", async () => {
    const { run, calls } = fakeSecurity((args) => inventory(args) ?? {});
    const keychain = createKeychain(run);
    for (const id of [A, "-N; rm -rf /", ""]) {
      await expect(keychain.sign("<x/>", id)).rejects.toThrow(
        "no longer in your Keychain",
      );
    }
    expect(calls.some((call) => call.args[0] === "cms")).toBe(false);
  });

  it("explains a refused signature, e.g. Deny in the Keychain prompt", async () => {
    const { run } = fakeSecurity((args) =>
      inventory(args) ?? {
        success: false,
        stderr: "security: problem signing\nsecurity: User canceled\n",
      }
    );
    await expect(createKeychain(run).sign("<x/>", WITH_SKI.sha1)).rejects
      .toThrow("Signing with \u201c.mobileconfig\u201d failed (User canceled)");
  });

  it("does not return a signature whose content differs", async () => {
    const { run } = fakeSecurity((args) =>
      inventory(args) ??
        (args.includes("-S")
          ? { stdout: SIGNED }
          : { stdout: encode("<plist>something else</plist>") })
    );
    await expect(createKeychain(run).sign("<x/>", WITH_SKI.sha1)).rejects
      .toThrow("did not check out");
  });

  it("reports an unreadable keychain", async () => {
    const { run } = fakeSecurity(() => ({
      success: false,
      stderr: "security: SecKeychainSearchCreate: access denied\n",
    }));
    await expect(createKeychain(run).list()).rejects.toThrow(
      "Could not read your Keychain",
    );
  });
});
