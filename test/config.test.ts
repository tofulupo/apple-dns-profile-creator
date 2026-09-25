/**
 * Guards the deployment settings in `src/config.ts`.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { appConfig } from "../src/config.ts";
import { serverError } from "../src/lib/validate.ts";

describe("presets", () => {
  it("offers at most six", () => {
    expect(appConfig.presets.length).toBeLessThanOrEqual(6);
  });

  it("have unique names", () => {
    const names = appConfig.presets.map((preset) => preset.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const preset of appConfig.presets) {
    it(`${preset.name} has a name`, () => {
      expect(preset.name.trim()).not.toBe("");
    });

    it(`${preset.name} passes the form's server check`, () => {
      expect(serverError(preset.protocol, preset.serverUrl)).toBeNull();
    });
  }
});
