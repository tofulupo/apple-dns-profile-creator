/**
 * Tests for the theme choice: what is read back, and the switch's order.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { nextTheme, readTheme, THEME_KEY } from "../../src/ui/theme.ts";

function storage(value: string | null): Pick<Storage, "getItem"> {
  return {
    getItem: (key) => (key === THEME_KEY ? value : null),
  };
}

describe("readTheme", () => {
  it("defaults to the system theme", () => {
    expect(readTheme(storage(null))).toBe("system");
  });

  it("returns a stored light or dark choice", () => {
    expect(readTheme(storage("light"))).toBe("light");
    expect(readTheme(storage("dark"))).toBe("dark");
  });

  it("ignores anything else", () => {
    expect(readTheme(storage("system"))).toBe("system");
    expect(readTheme(storage("blue"))).toBe("system");
  });

  it("falls back to the system theme when storage throws", () => {
    const blocked = {
      getItem: (): string | null => {
        throw new DOMException("denied", "SecurityError");
      },
    };
    expect(readTheme(blocked)).toBe("system");
  });
});

describe("nextTheme", () => {
  it("cycles system, light, dark", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });
});
