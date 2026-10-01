#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * Regenerates the app's single-image icons after `desktop/AppIcon.icon` (an
 * Icon Composer document) changes. The app bundle gets the .icon itself,
 * compiled by Tauri's bundler with Xcode's `actool`, for its light, dark and
 * tinted looks; macOS before 26 cannot read that and uses these instead:
 *
 * 1. Renders `desktop/AppIcon.png` from the .icon with Icon Composer's
 *    `ictool`, which ships inside Xcode.
 * 2. Generates the icons listed in `src-tauri/tauri.conf.json` from it with
 *    `tauri icon`, leaving out the many others it makes for other platforms.
 *
 *   deno task desktop:icon
 *
 * Unscoped --allow-run, as ictool's path depends on where Xcode is installed.
 */
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

/** Icon Composer's renderer, which ships inside Xcode. */
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

/** The icon files in `src-tauri/icons/` that tauri.conf.json lists. */
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
      // deno.json's import, which `deno task deps:update` keeps current.
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
