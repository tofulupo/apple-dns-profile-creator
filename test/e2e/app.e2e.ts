import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { addPreset, cardNames, useApp } from "./app.ts";

describe({
  name: "the app",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  const app = useApp();

  it("Pick a preset and add it to the profile", async () => {
    await addPreset(app(), "Quad9");

    expect(await cardNames(app())).toEqual(["Quad9"]);
  });
});
