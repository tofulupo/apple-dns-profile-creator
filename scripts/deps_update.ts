/**
 * `deno task deps:update`: brings the dependencies up to their latest
 * compatible releases, the Tauri CLI and crates among them, without crossing
 * a major version or taking anything published in the last day.
 *
 * `deno update` covers deno.json's imports, the Tauri CLI included, and keeps
 * to Deno's minimum dependency age (24 hours by default) by itself. Cargo has
 * no such rule yet (`-Z min-publish-age` is unstable), so for
 * src-tauri/Cargo.lock this script asks Cargo what it would update, looks up
 * each version's publish time in the crates.io index, and updates each crate
 * only to the newest of those versions that is old enough. Crates whose
 * newest version is old enough update together, since Tauri's crates pin each
 * other's exact versions.
 */
import { dirname, fromFileUrl, join } from "@std/path";
import {
  compare,
  format,
  greaterThan,
  lessOrEqual,
  parse,
  type SemVer,
} from "@std/semver";

const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const MANIFEST = join(ROOT, "src-tauri", "Cargo.toml");

/** The same as Deno's default minimum dependency age. */
export const MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** A crate `cargo update` would move to another version. */
export interface CargoUpdate {
  readonly name: string;
  readonly from: string;
  readonly to: string;
}

/** One version of a crate, as the crates.io index lists it. */
export interface IndexEntry {
  readonly vers: string;
  readonly yanked: boolean;
  /** Missing from versions published before the index recorded it. */
  readonly pubtime?: string;
}

/** The updates in `cargo update --dry-run`'s output. */
export function parseDryRun(output: string): CargoUpdate[] {
  return [...output.matchAll(/^\s*Updating (\S+) v(\S+) -> v(\S+)$/gm)].map((
    [, name = "", from = "", to = ""],
  ) => ({ name, from, to }));
}

/** Where the crates.io sparse index keeps a crate's versions. */
export function indexPath(name: string): string {
  const crate = name.toLowerCase();
  switch (crate.length) {
    case 1:
      return `1/${crate}`;
    case 2:
      return `2/${crate}`;
    case 3:
      return `3/${crate[0]}/${crate}`;
    default:
      return `${crate.slice(0, 2)}/${crate.slice(2, 4)}/${crate}`;
  }
}

/**
 * The newest version past `update.from`, up to the `update.to` Cargo chose,
 * that is not yanked, not a pre-release unless that is what Cargo chose, and
 * at least `MIN_AGE_MS` old at `now`. Undefined when none is.
 */
export function pickVersion(
  update: CargoUpdate,
  entries: readonly IndexEntry[],
  now: number,
): string | undefined {
  const from = parse(update.from);
  const to = parse(update.to);
  const preRelease = (to.prerelease?.length ?? 0) > 0;
  const candidates: SemVer[] = [];
  for (const entry of entries) {
    if (entry.yanked) continue;
    if (
      entry.pubtime !== undefined &&
      now - Date.parse(entry.pubtime) < MIN_AGE_MS
    ) continue;
    let version: SemVer;
    try {
      version = parse(entry.vers);
    } catch {
      continue;
    }
    if (!preRelease && (version.prerelease?.length ?? 0) > 0) continue;
    if (greaterThan(version, from) && lessOrEqual(version, to)) {
      candidates.push(version);
    }
  }
  const newest = candidates.sort(compare).at(-1);
  return newest === undefined ? undefined : format(newest);
}

/** When `version` of a crate turns old enough, if it is not yet. */
function eligibleAt(
  version: string,
  entries: readonly IndexEntry[],
): Date | undefined {
  const pubtime = entries.find((each) => each.vers === version)?.pubtime;
  return pubtime === undefined
    ? undefined
    : new Date(Date.parse(pubtime) + MIN_AGE_MS);
}

async function run(
  command: string,
  args: string[],
  quiet = false,
): Promise<{ success: boolean; output: string }> {
  const result = await new Deno.Command(command, {
    args,
    cwd: ROOT,
    stdout: quiet ? "piped" : "inherit",
    stderr: quiet ? "piped" : "inherit",
  }).output();
  if (!quiet) return { success: result.success, output: "" };
  const decoder = new TextDecoder();
  return {
    success: result.success,
    output: decoder.decode(result.stdout) + decoder.decode(result.stderr),
  };
}

async function indexEntries(name: string): Promise<IndexEntry[]> {
  const response = await fetch(
    `https://index.crates.io/${indexPath(name)}`,
  );
  if (!response.ok) {
    throw new Error(`crates.io index: ${name}: ${response.status}`);
  }
  return (await response.text()).trim().split("\n").map((line) =>
    JSON.parse(line) as IndexEntry
  );
}

function cargoUpdate(args: string[]) {
  return run("cargo", ["update", "--manifest-path", MANIFEST, ...args], true);
}

async function updateCrates(): Promise<void> {
  const held = new Map<string, string>();
  const updated: string[] = [];
  const now = Date.now();
  // Updating some crates can change what Cargo would do with the rest, so
  // ask again until a round changes nothing.
  for (let changed = true; changed;) {
    changed = false;
    const dryRun = await cargoUpdate(["--dry-run"]);
    if (!dryRun.success) throw new Error(dryRun.output);
    const together: CargoUpdate[] = [];
    const precise: [CargoUpdate, string][] = [];
    for (const update of parseDryRun(dryRun.output)) {
      const key = `${update.name}@${update.from}`;
      if (held.has(key)) continue;
      const entries = await indexEntries(update.name);
      const target = pickVersion(update, entries, now);
      if (target === update.to) {
        together.push(update);
      } else if (target !== undefined) {
        precise.push([update, target]);
      } else {
        const at = eligibleAt(update.to, entries);
        held.set(
          key,
          `${update.name} ${update.from} -> ${update.to}${
            at === undefined ? "" : `, from ${at.toISOString()}`
          }`,
        );
      }
    }
    if (together.length > 0) {
      const result = await cargoUpdate(
        together.flatMap(({ name, from }) => ["--package", `${name}@${from}`]),
      );
      for (const { name, from, to } of together) {
        if (result.success) {
          updated.push(`${name} ${from} -> ${to}`);
        } else {
          held.set(`${name}@${from}`, `${name} ${from} -> ${to}: failed`);
        }
      }
      if (!result.success) console.error(result.output.trim());
      changed ||= result.success;
    }
    for (const [{ name, from }, target] of precise) {
      const result = await cargoUpdate([
        "--package",
        `${name}@${from}`,
        "--precise",
        target,
      ]);
      if (result.success) {
        updated.push(`${name} ${from} -> ${target}`);
        changed = true;
      } else {
        held.set(`${name}@${from}`, `${name} ${from} -> ${target}: failed`);
      }
    }
  }
  console.log(
    updated.length === 0
      ? "Crates: nothing to update."
      : `Crates updated:\n  ${updated.join("\n  ")}`,
  );
  if (held.size > 0) {
    console.log(
      `Crates held back, published less than a day ago:\n  ${
        [...held.values()].join("\n  ")
      }`,
    );
  }
}

if (import.meta.main) {
  const deno = await run("deno", ["update"]);
  if (!deno.success) Deno.exit(1);
  await updateCrates();
}
