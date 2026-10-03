import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import type { OpenedProfile } from "../../src/desktop/bindings.ts";
import { receiveOpenedProfiles } from "../../src/ui/opened.ts";

function fakeApp(...queued: OpenedProfile[]) {
  const queue = [...queued];
  let notify: (() => void) | undefined;
  return {
    queue,
    open(...profiles: OpenedProfile[]) {
      queue.push(...profiles);
      notify?.();
    },
    bindings: {
      takeOpenedProfile: () => Promise.resolve(queue.shift() ?? null),
      onProfilesOpened: (listener: () => void) => {
        notify = listener;
        return Promise.resolve();
      },
    },
  };
}

const profile = (name: string): OpenedProfile => ({
  name,
  text: `<plist>${name}</plist>`,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("receiveOpenedProfiles", () => {
  it("does nothing in a browser", async () => {
    const imported: File[] = [];
    await receiveOpenedProfiles((file) => {
      imported.push(file);
      return Promise.resolve();
    }, undefined);
    expect(imported).toEqual([]);
  });

  it("imports the profiles that launched the app, in order, as files", async () => {
    const app = fakeApp(profile("a.mobileconfig"), profile("b.mobileconfig"));
    const imported: File[] = [];
    await receiveOpenedProfiles((file) => {
      imported.push(file);
      return Promise.resolve();
    }, app.bindings);

    expect(imported.map((file) => file.name)).toEqual([
      "a.mobileconfig",
      "b.mobileconfig",
    ]);
    expect(await imported[0]?.text()).toBe("<plist>a.mobileconfig</plist>");
    expect(imported[0]?.type).toBe("application/x-apple-aspen-config");
    expect(app.queue).toEqual([]);
  });

  it("imports profiles opened later, even during an import", async () => {
    const app = fakeApp();
    const imported: string[] = [];
    await receiveOpenedProfiles(async (file) => {
      imported.push(file.name);
      if (file.name === "a.mobileconfig") app.open(profile("c.mobileconfig"));
      await settle();
    }, app.bindings);

    app.open(profile("a.mobileconfig"), profile("b.mobileconfig"));
    await settle();
    await settle();
    await settle();
    await settle();

    expect(imported).toEqual([
      "a.mobileconfig",
      "b.mobileconfig",
      "c.mobileconfig",
    ]);
  });

  it("leaves the rest queued for the next page when an import leaves", async () => {
    const app = fakeApp(
      profile("several.mobileconfig"),
      profile("next.mobileconfig"),
    );
    const imported: string[] = [];
    await receiveOpenedProfiles((file) => {
      imported.push(file.name);
      return Promise.resolve(false);
    }, app.bindings);

    app.open(profile("later.mobileconfig"));
    await settle();

    expect(imported).toEqual(["several.mobileconfig"]);
    expect(app.queue.map((queued) => queued.name)).toEqual([
      "next.mobileconfig",
      "later.mobileconfig",
    ]);
  });
});
