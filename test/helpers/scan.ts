import { walkSync } from "@std/fs";
import { join, relative, resolve } from "@std/path";

const here = import.meta.dirname;
if (here === undefined) throw new Error("Must be loaded from a file URL");
export const ROOT = resolve(here, "..", "..");

export function files(dir: string, exts: readonly string[]): string[] {
  return [...walkSync(join(ROOT, dir), { exts: [...exts], includeDirs: false })]
    .map((entry) => relative(ROOT, entry.path))
    .sort();
}

export function read(path: string): string {
  return Deno.readTextFileSync(join(ROOT, path));
}

export function linesMatching(
  paths: readonly string[],
  pattern: RegExp,
): string[] {
  return paths.flatMap((path) =>
    read(path).split("\n").flatMap((line, index) =>
      pattern.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : []
    )
  );
}

interface TauriConfig {
  readonly app: {
    readonly windows: readonly { readonly label: string; create?: boolean }[];
    readonly security: {
      readonly csp: string;
      readonly freezePrototype?: boolean;
    };
  };
  readonly bundle: { readonly createUpdaterArtifacts?: unknown };
  readonly plugins?: Record<string, unknown>;
}

export function tauriConfig(): TauriConfig {
  return JSON.parse(read("src-tauri/tauri.conf.json"));
}

export function cspDirectives(): Map<string, string[]> {
  return new Map(
    tauriConfig().app.security.csp.split(";").map((directive) => {
      const [name = "", ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

export function capabilityPermissions(): string[] {
  return files("src-tauri/capabilities", [".json"]).flatMap((path) =>
    (JSON.parse(read(path)) as { permissions: string[] }).permissions
  );
}

export function rustDependencies(target: string): string[] {
  const output = new Deno.Command("cargo", {
    args: [
      "tree",
      "--manifest-path",
      join(ROOT, "src-tauri", "Cargo.toml"),
      "--locked",
      "--target",
      target,
      "--edges",
      "normal",
      "--prefix",
      "none",
      "--format",
      "{p}",
    ],
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!output.success) {
    throw new Error(
      `cargo tree failed: ${new TextDecoder().decode(output.stderr)}`,
    );
  }
  const names = new TextDecoder().decode(output.stdout).split("\n")
    .map((line) => line.split(" ")[0] ?? "")
    .filter((name) => name !== "");
  return [...new Set(names)].sort();
}
