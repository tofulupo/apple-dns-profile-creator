import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { distinctSettings, sameSettings } from "../../src/lib/settings.ts";
import { config } from "../helpers/configs.ts";

describe("sameSettings", () => {
  it("ignores the paradigm and the file a configuration came from", () => {
    expect(sameSettings(
      config({ paradigm: "payload", source: { file: "a.mobileconfig" } }),
      config({ paradigm: "declarations", source: { file: "b.mobileconfig" } }),
    )).toBe(true);
  });

  it("does not depend on the order keys were written in", () => {
    const { name, ...rest } = config();
    expect(sameSettings({ ...rest, name }, config())).toBe(true);
  });

  it("tells different settings apart", () => {
    expect(sameSettings(config(), config({ name: "Other" }))).toBe(false);
  });
});

describe("distinctSettings", () => {
  it("keeps the first of each, in order", () => {
    const first = config({ source: { file: "a.mobileconfig" } });
    const other = config({ name: "Other" });
    const repeat = config({ source: { file: "a 2.mobileconfig" } });
    expect(distinctSettings([first, other, repeat])).toEqual([first, other]);
  });
});
