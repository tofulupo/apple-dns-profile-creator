#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run=xcode-select,xcrun,plutil,codesign
/**
 * Finishes the macOS app that `deno desktop` packaged, then re-signs it, since
 * changing the bundle breaks the signature `deno desktop` applied:
 *
 * - Removes the camera, microphone and Bluetooth permission texts that
 *   `deno desktop` adds to every app. This one uses none of them, and they
 *   would suggest otherwise to anyone reading the bundle.
 * - Gives it an icon that follows light and dark mode. `deno desktop` only
 *   takes a single image, baked into AppIcon.icns; this compiles
 *   `desktop/AppIcon.icon` (an Icon Composer document) with Xcode's `actool`
 *   into the bundle. Without Xcode the app keeps the single icon rendered
 *   from `desktop/AppIcon.png`.
 *
 *   deno task desktop           runs this after packaging
 *   deno task desktop:icon      re-renders desktop/AppIcon.png from the .icon;
 *                               unscoped --allow-run, as ictool's path
 *                               depends on where Xcode is installed
 */
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const ICON = join(ROOT, "desktop", "AppIcon.icon");
const FALLBACK_PNG = join(ROOT, "desktop", "AppIcon.png");
/** Icon Composer icons are read by macOS 26 and later; older ones use the .icns. */
const MINIMUM_MACOS = "26.0";

interface Manifest {
  readonly desktop: {
    readonly output: { readonly macos: string };
    readonly macos?: { readonly codesignIdentity?: string };
  };
}

async function run(
  command: string,
  args: string[],
): Promise<{ success: boolean; output: string }> {
  try {
    const { success, stdout, stderr } = await new Deno.Command(command, {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    return {
      success,
      output: (decoder.decode(stdout) + decoder.decode(stderr)).trim(),
    };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { success: false, output: `${command} not found` };
    }
    throw error;
  }
}

async function must(command: string, args: string[]): Promise<void> {
  const result = await run(command, args);
  if (!result.success) {
    throw new Error(`${command} ${args[0] ?? ""} failed:\n${result.output}`);
  }
}

/** Xcode's `actool`, when it is installed and set up. */
async function actoolAvailable(): Promise<boolean> {
  const { success, output } = await run("xcrun", ["actool", "--version"]);
  if (!success || output.includes("required plugin failed to load")) {
    console.warn(
      "app icon: Xcode's actool is not available, keeping the single icon." +
        (output.includes("plugin") ? " Run: xcodebuild -runFirstLaunch" : ""),
    );
    return false;
  }
  return true;
}

/** Icon Composer's renderer, which ships inside Xcode. */
async function ictoolPath(): Promise<string> {
  const { success, output } = await run("xcode-select", ["-p"]);
  if (!success) throw new Error("Xcode is needed to render the icon.");
  return join(
    output,
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
  console.log(`app icon: rendered ${FALLBACK_PNG}`);
}

/**
 * Removes every `NS…UsageDescription` key from the bundle's Info.plist. macOS
 * shows these texts when an app asks for camera, microphone, Bluetooth and
 * similar access; this app never asks. Returns the keys it removed.
 */
export async function removeUsageDescriptions(
  plist: string,
): Promise<string[]> {
  const { success, output } = await run("plutil", [
    "-convert",
    "json",
    "-o",
    "-",
    plist,
  ]);
  if (!success) throw new Error(`plutil could not read ${plist}:\n${output}`);
  const keys = Object.keys(JSON.parse(output) as Record<string, unknown>)
    .filter((key) => /^NS\w+UsageDescription$/.test(key));
  for (const key of keys) await must("plutil", ["-remove", key, plist]);
  return keys;
}

/** Compiles the light, dark and tinted icon into the bundle. */
async function installIcon(app: string): Promise<boolean> {
  if (!await actoolAvailable()) return false;
  const resources = join(app, "Contents", "Resources");

  const compiled = await Deno.makeTempDir({ prefix: "dns-app-icon-" });
  try {
    await must("xcrun", [
      "actool",
      "--compile",
      compiled,
      "--platform",
      "macosx",
      "--minimum-deployment-target",
      MINIMUM_MACOS,
      "--app-icon",
      "AppIcon",
      "--output-partial-info-plist",
      join(compiled, "partial.plist"),
      ICON,
    ]);
    // Assets.car carries the light, dark and tinted looks for macOS 26+;
    // actool's AppIcon.icns replaces deno desktop's for older systems.
    for (const file of ["Assets.car", "AppIcon.icns"]) {
      await Deno.copyFile(join(compiled, file), join(resources, file));
    }
  } finally {
    await Deno.remove(compiled, { recursive: true });
  }

  const plist = join(app, "Contents", "Info.plist");
  await must("plutil", [
    "-replace",
    "CFBundleIconName",
    "-string",
    "AppIcon",
    plist,
  ]);
  await must("plutil", [
    "-replace",
    "CFBundleIconFile",
    "-string",
    "AppIcon",
    plist,
  ]);
  return true;
}

async function finishApp(): Promise<void> {
  if (Deno.build.os !== "darwin") return;

  const manifest = JSON.parse(
    await Deno.readTextFile(join(ROOT, "deno.json")),
  ) as Manifest;
  // `deno desktop` appends .app to the configured output path.
  const app = `${resolve(ROOT, manifest.desktop.output.macos)}.app`;
  const identity = manifest.desktop.macos?.codesignIdentity ?? "-";

  const removed = await removeUsageDescriptions(
    join(app, "Contents", "Info.plist"),
  );
  const iconInstalled = await installIcon(app);

  // The nested binaries are untouched and keep deno desktop's signatures;
  // only the bundle itself needs signing again.
  await must("codesign", ["--force", "--sign", identity, app]);
  await must("codesign", ["--verify", "--strict", app]);

  if (removed.length > 0) {
    console.log(`app: removed ${removed.length} unused permission texts`);
  }
  if (iconInstalled) {
    // Nudges Finder and the Dock to drop the cached icon.
    const now = new Date();
    await Deno.utime(app, now, now);
    console.log(`app icon: installed light and dark icon in ${app}`);
  }
}

if (import.meta.main) {
  if (Deno.args.includes("--render-fallback")) await renderFallback();
  else await finishApp();
}
