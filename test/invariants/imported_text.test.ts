import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { linesMatching, pageCode } from "../helpers/scan.ts";

const MARKUP =
  /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|srcdoc|createContextualFragment|parseFromString/;

describe("imported text is never treated as HTML", () => {
  it("has no page code that parses text as markup or runs it as code", () => {
    expect(linesMatching(pageCode(), MARKUP)).toEqual([]);
  });

  it("would notice markup made from text", () => {
    for (
      const line of [
        "card.innerHTML = name;",
        'eval("1")',
        "new DOMParser().parseFromString(xml, 'text/html')",
      ]
    ) {
      expect(MARKUP.test(line)).toBe(true);
    }
  });
});
