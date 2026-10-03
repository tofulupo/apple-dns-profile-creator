#!/usr/bin/env -S deno run --env-file=.env.release --allow-read --allow-write --allow-run --allow-env
import { basename, dirname, fromFileUrl, join, resolve } from "@std/path";

const ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const OUT = join(ROOT, "build", "desktop");

export const TARGETS = [
  { rust: "aarch64-apple-darwin", arch: "arm64" },
  { rust: "x86_64-apple-darwin", arch: "x86_64" },
] as const;

const SIGNING = ["APPLE_SIGNING_IDENTITY"];
const NOTARIZING = ["APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_PATH"];

export function missingSettings(
  env: Readonly<Record<string, string | undefined>>,
  signOnly: boolean,
): string[] {
  return [...SIGNING, ...(signOnly ? [] : NOTARIZING)].filter((name) =>
    (env[name] ?? "").trim() === ""
  );
}

export function identityProblem(identity: string): string | null {
  if (identity.trim() === "-") {
    return "APPLE_SIGNING_IDENTITY is `-`, the ad-hoc identity. Set it to " +
      "your Developer ID Application certificate.";
  }
  return null;
}

export function releaseName(version: string, arch: string): string {
  return `DNS-Profile-Creator-${version}-${arch}.dmg`;
}

async function run(command: string, args: string[]): Promise<string> {
  const { success, stdout } = await new Deno.Command(command, {
    args,
    cwd: ROOT,
    stdout: "piped",
    stderr: "inherit",
  }).output();
  const output = new TextDecoder().decode(stdout);
  if (!success) {
    console.error(output);
    throw new Error(`${command} ${args.join(" ")} failed; see above.`);
  }
  return output;
}

async function stream(
  command: string,
  args: string[],
  env?: Record<string, string>,
): Promise<void> {
  const { success } = await new Deno.Command(command, {
    args,
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
    ...(env !== undefined && { env, clearEnv: true }),
  }).output();
  if (!success) throw new Error(`${command} ${args.join(" ")} failed.`);
}

async function readVersion(): Promise<string> {
  const config = JSON.parse(
    await Deno.readTextFile(join(ROOT, "deno.json")),
  ) as { version?: unknown };
  if (typeof config.version !== "string") {
    throw new Error("deno.json has no version.");
  }
  return config.version;
}

async function builtDmg(rust: string): Promise<string> {
  const folder = join(
    ROOT,
    "src-tauri",
    "target",
    rust,
    "release",
    "bundle",
    "dmg",
  );
  const dmgs: string[] = [];
  for await (const entry of Deno.readDir(folder)) {
    if (entry.isFile && entry.name.endsWith(".dmg")) {
      dmgs.push(join(folder, entry.name));
    }
  }
  const [dmg, ...others] = dmgs;
  if (dmg === undefined || others.length > 0) {
    throw new Error(`Expected one DMG in ${folder}, found ${dmgs.length}.`);
  }
  return dmg;
}

async function sha256(path: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await Deno.readFile(path),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function release(signOnly: boolean): Promise<void> {
  const env = Deno.env.toObject();
  const missing = missingSettings(env, signOnly);
  if (missing.length > 0) {
    throw new Error(
      `Missing in .env.release: ${missing.join(", ")}. ` +
        "Copy .env.release.example to .env.release and fill it in.",
    );
  }
  const identity = env["APPLE_SIGNING_IDENTITY"] ?? "";
  const problem = identityProblem(identity);
  if (problem !== null) throw new Error(problem);
  if (!signOnly) await Deno.stat(env["APPLE_API_KEY_PATH"] ?? "");

  const buildEnv = signOnly
    ? Object.fromEntries(
      Object.entries(env).filter(([name]) => !NOTARIZING.includes(name)),
    )
    : undefined;
  const notarytoolAuth = [
    "--key",
    env["APPLE_API_KEY_PATH"] ?? "",
    "--key-id",
    env["APPLE_API_KEY"] ?? "",
    "--issuer",
    env["APPLE_API_ISSUER"] ?? "",
  ];

  const version = await readVersion();
  await Deno.mkdir(OUT, { recursive: true });
  const sums: string[] = [];

  for (const target of TARGETS) {
    console.log(`\n== ${target.arch} (${target.rust})\n`);
    await stream(Deno.execPath(), [
      "task",
      "tauri",
      "build",
      "--target",
      target.rust,
      "--bundles",
      "app,dmg",
    ], buildEnv);

    const dmg = join(OUT, releaseName(version, target.arch));
    await Deno.copyFile(await builtDmg(target.rust), dmg);
    const app = join(
      ROOT,
      "src-tauri",
      "target",
      target.rust,
      "release",
      "bundle",
      "macos",
      "DNS Profile Creator.app",
    );

    await run("codesign", [
      "--force",
      "--sign",
      identity,
      "--timestamp",
      dmg,
    ]);
    await run("codesign", ["--verify", "--deep", "--strict", app]);
    if (!signOnly) {
      console.log(`Notarizing ${basename(dmg)}; this takes a few minutes…`);
      await stream("xcrun", [
        "notarytool",
        "submit",
        dmg,
        ...notarytoolAuth,
        "--wait",
      ]);
      await run("xcrun", ["stapler", "staple", dmg]);
      await run("spctl", ["--assess", "--type", "execute", app]);
      await run("spctl", [
        "--assess",
        "--type",
        "open",
        "--context",
        "context:primary-signature",
        dmg,
      ]);
      await run("xcrun", ["stapler", "validate", app]);
    }
    sums.push(`${await sha256(dmg)}  ${basename(dmg)}`);
  }

  await Deno.writeTextFile(join(OUT, "SHA256SUMS"), sums.join("\n") + "\n");
  console.log(`\nIn build/desktop/:\n${sums.join("\n")}`);
  if (signOnly) {
    console.log(
      "\nSigned, not notarized: these only open on this Mac. Drop --sign-only " +
        "for a release.",
    );
  }
}

if (import.meta.main) {
  try {
    await release(Deno.args.includes("--sign-only"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}
