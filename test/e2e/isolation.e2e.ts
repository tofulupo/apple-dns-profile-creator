import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { useApp } from "./app.ts";

describe({
  name: "calls into the app",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  const app = useApp();

  it("reach Rust, which decides, or get no answer when the hook drops them", async () => {
    const answers = await app().execute(() => {
      const { invoke } = (window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown) => Promise<unknown>;
        };
      }).__TAURI_INTERNALS__;
      const answer = (call: Promise<unknown>) =>
        Promise.race([
          call.then(() => "answered", () => "refused"),
          new Promise<string>((done) => setTimeout(() => done("none"), 2000)),
        ]);
      return Promise.all([
        answer(invoke("list_signing_identities")),
        // Settings' command: passes the hook, the main window's capability refuses it.
        answer(invoke("forget_on_quit")),
        answer(invoke("not_a_command")),
        answer(invoke("set_share_enabled", { enabled: true, more: 1 })),
        answer(invoke("set_appearance", { appearance: "neon" })),
      ]);
    });
    expect(answers).toEqual(["answered", "refused", "none", "none", "none"]);
  });

  it("go through an isolation frame nobody sees", async () => {
    const frame = await app().$("#__tauri_isolation__");
    await frame.waitForExist();
    expect(await frame.isDisplayed()).toBe(false);
  });
});
