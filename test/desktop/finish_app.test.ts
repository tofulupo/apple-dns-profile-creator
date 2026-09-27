/**
 * Tests for finishing the packaged macOS app.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join } from "@std/path";

import { removeUsageDescriptions } from "../../scripts/app_icon.ts";

/** Shaped like the Info.plist `deno desktop` writes. */
const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>local.example.app</string>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>NSCameraUsageDescription</key><string>requires access to the camera</string>
  <key>NSMicrophoneUsageDescription</key><string>requires the microphone</string>
  <key>NSBluetoothAlwaysUsageDescription</key><string>requires Bluetooth</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;

describe("removeUsageDescriptions", {
  // plutil ships with macOS only.
  ignore: Deno.build.os !== "darwin",
}, () => {
  it("removes the permission texts and keeps everything else", async () => {
    const folder = await Deno.makeTempDir({ prefix: "dns-app-plist-" });
    try {
      const plist = join(folder, "Info.plist");
      await Deno.writeTextFile(plist, INFO_PLIST);

      const removed = await removeUsageDescriptions(plist);
      expect(removed.sort()).toEqual([
        "NSBluetoothAlwaysUsageDescription",
        "NSCameraUsageDescription",
        "NSMicrophoneUsageDescription",
      ]);

      const { stdout } = await new Deno.Command("plutil", {
        args: ["-convert", "json", "-o", "-", plist],
      }).output();
      expect(JSON.parse(new TextDecoder().decode(stdout))).toEqual({
        CFBundleIdentifier: "local.example.app",
        NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
        NSHighResolutionCapable: true,
      });

      // Nothing left to remove the second time.
      expect(await removeUsageDescriptions(plist)).toEqual([]);
    } finally {
      await Deno.remove(folder, { recursive: true });
    }
  });
});
