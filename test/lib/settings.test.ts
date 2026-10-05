import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { distinctSettings, sameSettings } from "../../src/lib/settings.ts";
import { config } from "../helpers/configs.ts";

describe("sameSettings", () => {
  it("ignores the paradigm", () => {
    expect(sameSettings(
      config({ paradigm: "payload" }),
      config({ paradigm: "declarations" }),
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
    const first = config({ paradigm: "payload" });
    const other = config({ name: "Other" });
    const repeat = config({ paradigm: "declarations" });
    expect(distinctSettings([first, other, repeat])).toEqual([first, other]);
  });
});
