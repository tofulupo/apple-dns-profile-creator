#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net --allow-run
// Desktop entrypoint: serves dist/ to the embedded webview and saves profiles
// through a binding, since the webview has no browser download manager.
/// <reference path="./desktop.d.ts" />
import { serveDir } from "@std/http/file-server";
import { fromFileUrl, isAbsolute, join } from "@std/path";

// Not Deno.cwd(): a compiled binary runs in the user's working directory, while
// dist/ is embedded next to this module.
const DIST = fromFileUrl(new URL("./dist", import.meta.url));

function homeDirectory(): string {
  return Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? Deno.cwd();
}

Deno.serve((request) => serveDir(request, { fsRoot: DIST, quiet: true }));

const main = new Deno.BrowserWindow({
  title: "DNS Profile Creator",
  width: 900,
  height: 840,
});

main.bind("saveProfile", async (filename: string, xml: string) => {
  const home = homeDirectory();
  const chosen = prompt(
    "Save the configuration profile as:",
    join(home, "Downloads", filename),
  );
  if (chosen === null) return;

  const target = isAbsolute(chosen) ? chosen : join(home, chosen);
  await Deno.writeTextFile(target, xml);

  // Opening a .mobileconfig on macOS hands it to System Settings, which is
  // where the profile has to be installed anyway.
  if (Deno.build.os === "darwin") {
    if (confirm(`Saved to ${target}.\n\nOpen it now to install?`)) {
      await new Deno.Command("open", { args: [target] }).output();
    }
    return;
  }

  alert(`Saved to ${target}.`);
});
