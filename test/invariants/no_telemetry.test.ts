import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { TARGETS } from "../../scripts/desktop_release.ts";
import { rustDependencies, tauriConfig } from "../helpers/scan.ts";

// Analytics, crash reporting and self-update crates, by name or prefix.
const TELEMETRY =
  /^(sentry|opentelemetry|posthog|aptabase|tauri-plugin-aptabase|tauri-plugin-updater|tauri-plugin-analytics|bugsnag|rollbar|datadog|segment|minidump|crash-handler|self_update|velopack|cargo-packager-updater)/;

describe("no telemetry, crash reporting or update checks", () => {
  for (const { rust: target } of TARGETS) {
    it(`builds none of them into the app for ${target}`, () => {
      expect(rustDependencies(target).filter((name) => TELEMETRY.test(name)))
        .toEqual([]);
    });
  }

  it("configures no updater", () => {
    const config = tauriConfig();
    expect(Object.keys(config.plugins ?? {})).not.toContain("updater");
    expect(config.bundle.createUpdaterArtifacts).toBeUndefined();
  });
});
