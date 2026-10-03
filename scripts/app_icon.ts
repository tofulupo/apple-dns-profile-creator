#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
import { dirname, fromFileUrl, join, relative, resolve } from "@std/path";

const ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const ICON = join(ROOT, "desktop", "AppIcon.icon");
const FALLBACK_PNG = join(ROOT, "desktop", "AppIcon.png");
const SRC_TAURI = join(ROOT, "src-tauri");
const ICONS = join(SRC_TAURI, "icons");

async function must(command: string, args: string[]): Promise<string> {
  const { success, stdout, stderr } = await new Deno.Command(command, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  const output = (decoder.decode(stdout) + decoder.decode(stderr)).trim();
  if (!success) {
    throw new Error(`${command} ${args[0] ?? ""} failed:\n${output}`);
  }
  return output;
}

async function ictoolPath(): Promise<string> {
  const developer = await must("xcode-select", ["-p"]).catch(() => {
    throw new Error("Xcode is needed to render the icon.");
  });
  return join(
    developer,
    "..",
    "Applications",
    "Icon Composer.app",
    "Contents",
    "Executables",
    "ictool",
  );
}

async function renderFallback(): Promise<void> {
  await must(await ictoolPath(), [
    ICON,
    "--export-image",
    "--output-file",
    FALLBACK_PNG,
    "--platform",
    "macOS",
    "--rendition",
    "Default",
    "--width",
    "1024",
    "--height",
    "1024",
    "--scale",
    "1",
  ]);
  console.log(`app icon: rendered ${relative(ROOT, FALLBACK_PNG)}`);
}

function listedIconFiles(config: unknown): string[] {
  const icons = (config as { bundle?: { icon?: unknown } }).bundle?.icon;
  if (!Array.isArray(icons)) return [];
  return icons
    .filter((icon): icon is string => typeof icon === "string")
    .filter((icon) => icon.startsWith("icons/"))
    .map((icon) => icon.slice("icons/".length));
}

async function generateTauriIcons(): Promise<void> {
  const config: unknown = JSON.parse(
    await Deno.readTextFile(join(SRC_TAURI, "tauri.conf.json")),
  );
  const files = listedIconFiles(config);
  const generated = await Deno.makeTempDir({ prefix: "dns-app-icons-" });
  try {
    await must(Deno.execPath(), [
      "run",
      "-A",
      "@tauri-apps/cli",
      "icon",
      FALLBACK_PNG,
      "--output",
      generated,
    ]);
    for (const file of files) {
      await Deno.copyFile(join(generated, file), join(ICONS, file));
    }
  } finally {
    await Deno.remove(generated, { recursive: true });
  }
  console.log(`app icon: generated ${files.join(", ")} in src-tauri/icons/`);
}

if (import.meta.main) {
  await renderFallback();
  await generateTauriIcons();
}
