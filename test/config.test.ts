/**
 * Guards the one value that is duplicated out of `deno.json`.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

import { appConfig } from "../src/config.ts";

const ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");

describe("app configuration", () => {
  it("carries the same version as deno.json", async () => {
    const manifest = JSON.parse(
      await Deno.readTextFile(join(ROOT, "deno.json")),
    ) as { version?: unknown };

    expect(typeof manifest.version).toBe("string");
    expect(appConfig.appVersion).toBe(manifest.version);
  });
});
