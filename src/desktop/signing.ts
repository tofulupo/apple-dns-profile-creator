/**
 * Signing profiles with a Keychain identity through macOS's own `security`
 * tool. The private key never leaves the Keychain; the first time, macOS asks
 * the user whether `security` may use it.
 */

import type { IdentityStatus, SigningIdentity } from "./bindings.ts";
import { pemToDer, subjectKeyId } from "./certificate.ts";

export interface RunResult {
  readonly success: boolean;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

/** Runs `security` with `args`, feeding it `stdin` when given. */
export type RunSecurity = (
  args: readonly string[],
  stdin?: Uint8Array,
) => Promise<RunResult>;

/** A line of `security find-identity`, before any filtering. */
export interface KeychainIdentity {
  readonly sha1: string;
  readonly name: string;
  /** The `CSSMERR_…` code macOS reports, absent for a trusted identity. */
  readonly error?: string;
}

/** What `security cms -S` needs to pick the identity. */
export type Selector = readonly ["-Z", string] | readonly ["-N", string];

/** Certificates that must not be offered: they can no longer be trusted. */
const UNUSABLE = new Set([
  "CSSMERR_TP_CERT_EXPIRED",
  "CSSMERR_TP_CERT_NOT_VALID_YET",
  "CSSMERR_TP_CERT_REVOKED",
]);

const IDENTITY_LINE =
  /^\s*\d+\)\s+([0-9A-F]{40})\s+"(.*)"(?:\s+\((\w+)\))?\s*$/;

/**
 * Reads `security find-identity -p basic`. Only the first section counts:
 * the "Valid identities only" section after it repeats a subset.
 */
export function parseFindIdentity(output: string): KeychainIdentity[] {
  const found = new Map<string, KeychainIdentity>();
  for (const line of output.split("\n")) {
    if (line.includes("Valid identities only")) break;
    const match = IDENTITY_LINE.exec(line);
    if (match === null) continue;
    const [, sha1 = "", name = "", error] = match;
    found.set(
      sha1,
      error === undefined ? { sha1, name } : { sha1, name, error },
    );
  }
  return [...found.values()];
}

/**
 * Reads `security find-certificate -a -Z -p`: each certificate's SHA-1 and
 * its Subject Key Identifier, if it has one.
 */
export function parseFindCertificate(
  output: string,
): Map<string, string | undefined> {
  const keyIds = new Map<string, string | undefined>();
  const block =
    /SHA-1 hash: ([0-9A-F]{40})\s+(-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----)/g;
  for (const [, sha1 = "", pem = ""] of output.matchAll(block)) {
    let keyId: string | undefined;
    try {
      keyId = subjectKeyId(pemToDer(pem));
    } catch {
      keyId = undefined;
    }
    keyIds.set(sha1, keyId);
  }
  return keyIds;
}

interface Usable extends SigningIdentity {
  readonly selector: Selector;
}

/**
 * The identities that can be offered, with how to select each. The Subject
 * Key Identifier is preferred, since names repeat (renewed certificates keep
 * theirs); without one, a name that is unique among all identities, expired
 * ones included, is used instead, and an identity with neither is left out.
 */
export function usableIdentities(
  all: readonly KeychainIdentity[],
  keyIds: ReadonlyMap<string, string | undefined>,
): Usable[] {
  const nameCounts = new Map<string, number>();
  for (const identity of all) {
    nameCounts.set(identity.name, (nameCounts.get(identity.name) ?? 0) + 1);
  }

  const usable: Usable[] = [];
  for (const identity of all) {
    if (identity.error !== undefined && UNUSABLE.has(identity.error)) continue;
    const keyId = keyIds.get(identity.sha1);
    const selector: Selector | undefined = keyId !== undefined
      ? ["-Z", keyId]
      : nameCounts.get(identity.name) === 1
      ? ["-N", identity.name]
      : undefined;
    if (selector === undefined) continue;
    const status: IdentityStatus = identity.error === undefined
      ? "trusted"
      : "untrusted";
    usable.push({ id: identity.sha1, name: identity.name, status, selector });
  }
  return usable.sort((a, b) => a.name.localeCompare(b.name));
}

async function runSecurity(
  args: readonly string[],
  stdin?: Uint8Array,
): Promise<RunResult> {
  const child = new Deno.Command("security", {
    args: [...args],
    stdin: stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  // Collected before writing, so a full stdout pipe cannot stall the write.
  const output = child.output();
  if (stdin !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(stdin);
    await writer.close();
  }
  const { success, stdout, stderr } = await output;
  return { success, stdout, stderr: new TextDecoder().decode(stderr) };
}

function lastLine(text: string): string {
  return text.trim().split("\n").at(-1)?.replace(/^security:\s*/, "") ?? "";
}

export interface Keychain {
  list(): Promise<SigningIdentity[]>;
  /** Signs `xml` with the listed identity `id`; returns the signed bytes. */
  sign(xml: string, id: string): Promise<{ signed: Uint8Array; name: string }>;
}

export function createKeychain(run: RunSecurity = runSecurity): Keychain {
  async function inventory(): Promise<Usable[]> {
    const [identities, certificates] = await Promise.all([
      run(["find-identity", "-p", "basic"]),
      run(["find-certificate", "-a", "-Z", "-p"]),
    ]);
    if (!identities.success) {
      throw new Error(
        `Could not read your Keychain: ${lastLine(identities.stderr)}`,
      );
    }
    const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    return usableIdentities(
      parseFindIdentity(decode(identities.stdout)),
      certificates.success
        ? parseFindCertificate(decode(certificates.stdout))
        : new Map(),
    );
  }

  return {
    async list() {
      return (await inventory()).map(({ id, name, status }) => ({
        id,
        name,
        status,
      }));
    },

    async sign(xml, id) {
      // Looked up again rather than trusting the page: the id must still name
      // a usable identity, and only the selector found here reaches `security`.
      const identity = (await inventory()).find((entry) => entry.id === id);
      if (identity === undefined) {
        throw new Error(
          "That certificate is no longer in your Keychain, or has expired.",
        );
      }

      const content = new TextEncoder().encode(xml);
      const signed = await run(
        ["cms", "-S", "-G", "-H", "SHA256", ...identity.selector],
        content,
      );
      if (!signed.success || signed.stdout.length === 0) {
        throw new Error(
          `Signing with “${identity.name}” failed (${
            lastLine(signed.stderr) || "no details"
          }). If macOS asked for permission to use the key, choose Allow.`,
        );
      }

      // Decoded with Apple's own reader: what gets saved must hold exactly
      // the profile that was built.
      const decoded = await run(["cms", "-D"], signed.stdout);
      if (
        !decoded.success || new TextDecoder().decode(decoded.stdout) !== xml
      ) {
        throw new Error(
          "The signed profile did not check out, so it was not saved.",
        );
      }

      return { signed: signed.stdout, name: identity.name };
    },
  };
}
