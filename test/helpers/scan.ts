import { walkSync } from "@std/fs";
import { fromFileUrl, join, relative, resolve } from "@std/path";

import { PAGE_ENTRYPOINTS } from "../../scripts/build.ts";

const here = import.meta.dirname;
if (here === undefined) throw new Error("Must be loaded from a file URL");
export const ROOT = resolve(here, "..", "..");

export function files(dir: string, exts: readonly string[]): string[] {
  return [...walkSync(join(ROOT, dir), { exts: [...exts], includeDirs: false })]
    .map((entry) => relative(ROOT, entry.path))
    .sort();
}

/** The local modules `entrypoint` imports, itself included, as `deno bundle`
 * follows them. */
export function moduleGraph(entrypoint: string): string[] {
  const { success, stdout, stderr } = new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", entrypoint],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!success) {
    throw new Error(
      `deno info ${entrypoint}: ${new TextDecoder().decode(stderr)}`,
    );
  }
  const graph = JSON.parse(new TextDecoder().decode(stdout)) as {
    modules: { specifier: string }[];
  };
  return graph.modules
    .map((module) => module.specifier)
    .filter((specifier) => specifier.startsWith("file:"))
    .map((specifier) => relative(ROOT, fromFileUrl(specifier)));
}

export function isolationDir(): string {
  const dir = tauriConfig().app.security.pattern?.options?.dir;
  if (dir === undefined) {
    throw new Error("tauri.conf.json has no isolation dir");
  }
  return relative(ROOT, join(ROOT, "src-tauri", dir));
}

let pageCodeCache: string[] | undefined;

/** Everything that runs in a page or is its markup. */
export function pageCode(): string[] {
  pageCodeCache ??= [
    ...new Set([
      ...files("src", [".ts"]),
      ...PAGE_ENTRYPOINTS.flatMap(moduleGraph),
      ...files(isolationDir(), [".js", ".html"]),
      ...files("pages", [".html"]),
    ]),
  ].sort();
  return pageCodeCache;
}

export function rustCode(): string[] {
  return files("src-tauri/src", [".rs"]);
}

/** Code files in the repo, new ones included, but not the ignored ones. */
export function repoCodeFiles(): string[] {
  const { success, stdout } = new Deno.Command("git", {
    args: ["ls-files", "--cached", "--others", "--exclude-standard"],
    cwd: ROOT,
    stdout: "piped",
  }).outputSync();
  if (!success) throw new Error("git ls-files failed");
  return new TextDecoder().decode(stdout).split("\n")
    .filter((path) => /\.(ts|tsx|js|jsx|mjs|cjs|html|rs)$/.test(path))
    .filter((path) => {
      try {
        return Deno.statSync(join(ROOT, path)).isFile;
      } catch {
        return false;
      }
    })
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
      readonly pattern?: {
        readonly use: string;
        readonly options?: { readonly dir?: string };
      };
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
