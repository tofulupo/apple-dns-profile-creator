#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-run
/**
 * Usage: deno task fixtures:fetch
 */
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const PAULMILLR_BASE =
  "https://raw.githubusercontent.com/paulmillr/encrypted-dns/master/profiles";
const MULLVAD_BASE =
  "https://raw.githubusercontent.com/mullvad/encrypted-dns-profiles/main";

const PAULMILLR_PROFILES = [
  "cloudflare-default-https",
  "cloudflare-default-tls",
  "quad9-default-tls",
  "quad9-ECS-https",
  "google-default-https",
  "adguard-family-tls",
  "mullvad-default-https",
  "dns4eu-protective-child-ads-tls",
  "360-default-https",
  "template-on-demand-default-https",
] as const;

const MULLVAD_PROFILES = [
  "all/mullvad-encrypted-dns-https-all",
  "all/mullvad-encrypted-dns-tls-all",
] as const;

async function download(url: string, target: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  await Deno.writeFile(target, new Uint8Array(await response.arrayBuffer()));
}

async function extractInnerPlist(
  source: string,
  target: string,
): Promise<void> {
  const result = await new Deno.Command("openssl", {
    args: [
      "smime",
      "-verify",
      "-noverify",
      "-inform",
      "DER",
      "-in",
      source,
      "-out",
      target,
    ],
    stdout: "null",
    stderr: "null",
  }).output();

  if (!result.success) {
    throw new Error(`openssl could not extract the plist from ${source}`);
  }
}

const paulmillrDir = join(ROOT, "test/fixtures/upstream/paulmillr");
const mullvadDir = join(ROOT, "test/fixtures/upstream/mullvad");
await Deno.mkdir(paulmillrDir, { recursive: true });
await Deno.mkdir(mullvadDir, { recursive: true });

console.log("Fetching paulmillr profiles (Unlicense)...");
for (const name of PAULMILLR_PROFILES) {
  const file = `${name}.mobileconfig`;
  await download(`${PAULMILLR_BASE}/${file}`, join(paulmillrDir, file));
  console.log(`  ok  ${name}`);
}

console.log("Fetching Mullvad profiles (unlicensed, not redistributed)...");
for (const path of MULLVAD_PROFILES) {
  const name = path.split("/").at(-1);
  if (name === undefined) throw new Error(`Malformed fixture path: ${path}`);

  const signed = join(mullvadDir, `${name}.mobileconfig`);
  await download(`${MULLVAD_BASE}/${path}.mobileconfig`, signed);
  await extractInnerPlist(signed, join(mullvadDir, `${name}.inner.plist`));
  console.log(`  ok  ${name} (+ inner plist)`);
}

console.log("Done.");
