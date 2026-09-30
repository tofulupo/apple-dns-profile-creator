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

  it("keeps the message of a failed desktop command", () => {
    // What a Tauri command's Err(String) looks like on the page side.
    const error = asError("Permission denied (os error 13)");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Permission denied (os error 13)");
  });
});
