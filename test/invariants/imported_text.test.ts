import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { files, linesMatching } from "../helpers/scan.ts";

describe("imported text is never treated as HTML", () => {
  it("has no page code that parses text as markup or runs it as code", () => {
    expect(
      linesMatching(
        files("src", [".ts"]),
        /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|srcdoc|createContextualFragment|parseFromString/,
      ),
    ).toEqual([]);
  });
});
