import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { files, linesMatching } from "../helpers/scan.ts";

/** A `uses:` that names a branch or tag, which can move, not a commit. */
const UNPINNED = /^\s*-?\s*uses:\s*(?!\.\/)(?![^@\s]+@[0-9a-f]{40}(\s|$))\S/;

describe("CI runs only the actions it reviewed", () => {
  it("pins every action to a commit", () => {
    const workflows = files(".github/workflows", [".yml", ".yaml"]);
    expect(workflows.length).toBeGreaterThan(0);
    expect(linesMatching(workflows, UNPINNED)).toEqual([]);
  });

  it("would notice an action on a tag or branch", () => {
    for (
      const line of [
        "      - uses: actions/checkout@v4",
        "      - uses: actions/checkout@main",
        "      - uses: actions/checkout@11d5960",
      ]
    ) {
      expect({ line, unpinned: UNPINNED.test(line) })
        .toEqual({ line, unpinned: true });
    }
    expect(
      UNPINNED.test(
        "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0",
      ),
    ).toBe(false);
  });
});
