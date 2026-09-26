/**
 * Tests for turning a save failure into a readable message.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { asError } from "../../src/ui/download.ts";

describe("asError", () => {
  it("passes an Error through unchanged", () => {
    const error = new TypeError("boom");
    expect(asError(error)).toBe(error);
  });

  it("keeps the message of a binding rejection, not [object Object]", () => {
    // What a desktop binding's rejection looks like on the page side.
    const rejection = {
      name: "PermissionDenied",
      message: "Permission denied (os error 13)",
      stack: "PermissionDenied: ...",
    };
    const error = asError(rejection);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Permission denied (os error 13)");
  });

  it("stringifies anything else", () => {
    expect(asError("plain text").message).toBe("plain text");
    expect(asError({ message: 42 }).message).toBe("[object Object]");
  });
});
