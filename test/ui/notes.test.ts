import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  ALREADY_IN_PROFILE,
  DOT_NOTE,
  type FileFacts,
  notesFor,
  onMullvad,
} from "../../src/ui/notes.ts";

const PLAIN: FileFacts = {
  file: "quad9.mobileconfig",
  configs: 1,
  signature: "none",
  legacy: false,
  dot: 0,
  mullvad: false,
  leftOut: [],
};

describe("the Mullvad note", () => {
  const MULLVAD = { ...PLAIN, mullvad: true };

  it("comes first, until 2 November 2026 in the user's time zone", () => {
    const [note] = notesFor(MULLVAD, false, new Date(2026, 10, 1, 23, 59));
    expect(note).toEqual({
      tone: "info",
      label: "Mullvad",
      value: "Stops on 2 November 2026",
      text:
        "Mullvad is shutting down its encrypted DNS. Pick another resolver, like Quad9. Your rules stay.",
    });
  });

  it("says it stopped from 2 November 2026 on", () => {
    const [note] = notesFor(MULLVAD, false, new Date(2026, 10, 2, 0, 0));
    expect(note).toEqual({
      tone: "warning",
      label: "Mullvad",
      value: "Stopped on 2 November 2026",
      text:
        "Mullvad shut down its encrypted DNS. Pick another resolver, like Quad9. Your rules stay.",
    });
  });

  it("isn't there for other servers", () => {
    expect(notesFor(PLAIN).map((note) => note.label)).not.toContain("Mullvad");
  });

  it("knows Mullvad's servers, for DoH and DoT", () => {
    for (
      const server of [
        "https://all.dns.mullvad.net/dns-query",
        "https://dns.mullvad.net/dns-query",
        "base.dns.mullvad.net",
        "ADBLOCK.DNS.MULLVAD.NET",
      ]
    ) {
      expect({ server, mullvad: onMullvad(server) })
        .toEqual({ server, mullvad: true });
    }
    for (
      const server of [
        "https://dns.quad9.net/dns-query",
        "https://mullvad.net.example.com/dns-query",
        "notmullvad.net",
      ]
    ) {
      expect({ server, mullvad: onMullvad(server) })
        .toEqual({ server, mullvad: false });
    }
  });
});

describe("notesFor", () => {
  it("warns that the website doesn't check a signature", () => {
    const [signature] = notesFor({ ...PLAIN, signature: "unchecked" });
    expect(signature).toEqual({
      tone: "warning",
      label: "Signature",
      value: "Not checked",
      text: "Browsers can't verify the signature or its certificate chain.",
    });
  });

  it("offers the Declaration format for the legacy payload", () => {
    const [, format] = notesFor({ ...PLAIN, legacy: true });
    expect(format).toEqual({
      tone: "info",
      label: "Format",
      value: "Legacy payload",
      text: "Deprecated by Apple in OS 27, still works.",
      action: {
        id: "use-declarations",
        label: "Use Declaration format",
        hint: "OS 26+",
      },
    });
  });

  it("says the download replaces the legacy payload once the switch is on", () => {
    const [, format] = notesFor({ ...PLAIN, legacy: true }, true);
    expect(format).toEqual({
      tone: "ok",
      label: "Format",
      value: "Declaration format on",
      text:
        "Replaces the file's legacy payload in your download. Needs OS 26+.",
      action: { id: "undo-declarations", label: "Undo", quiet: true },
    });
  });

  it("doesn't change a file with declarations when the switch is on", () => {
    expect(notesFor(PLAIN, true)).toEqual(notesFor(PLAIN));
  });

  it("only reports an unsigned file with declarations", () => {
    expect(notesFor(PLAIN)).toEqual([
      {
        tone: "neutral",
        label: "Signature",
        value: "Not signed",
        text: "Shown as “Not Signed” when installing.",
        calm: true,
      },
      {
        tone: "ok",
        label: "Format",
        value: "Declarations",
        text: "Apple's current format, OS 26+.",
        calm: true,
      },
    ]);
  });

  it("gathers what the import left out under one count", () => {
    const leftOut = [
      "Skipped payloads that are not DNS settings: com.apple.wifi.managed.",
      "Office: Left out resolver addresses beyond two IPv4 and two IPv6: “1.0.0.1”.",
      "Office: Ignored the SSID condition of the rule “Office”.",
    ];
    expect(notesFor({ ...PLAIN, leftOut }).at(-1)).toEqual({
      tone: "warning",
      label: "Not carried over",
      value: "3 settings left out",
      items: leftOut,
    });
    expect(notesFor({ ...PLAIN, leftOut: ["One."] }).at(-1)?.value)
      .toBe("1 setting left out");
  });

  it("tells that DoT is easier to block", () => {
    expect(notesFor({ ...PLAIN, dot: 1 })[2]).toEqual({
      tone: "info",
      label: "Protocol",
      value: "DNS over TLS",
      text:
        "DoH blends in with normal HTTPS; DoT is easier to detect and block.",
    });
    expect(notesFor({ ...PLAIN, configs: 3, dot: 2 })[2]?.value)
      .toBe("2 of 3 use DNS over TLS");
    expect(notesFor(PLAIN).map((note) => note.label)).not.toContain(
      "Protocol",
    );
  });

  it("says the same about DoT as the note under the URL field", async () => {
    const page = await Deno.readTextFile(
      new URL("../../pages/index.html", import.meta.url),
    );
    const [, note] = /id="protocolNote" hidden>([^<]+)</.exec(page) ?? [];
    expect(note?.replace(/\s+/g, " ")).toBe(DOT_NOTE);
  });

  it("keeps every kind of note to one tile, however much a file has", () => {
    const leftOut = Array.from(
      { length: 40 },
      (_, index) => `Left out a rule ${"x".repeat(index * 5)}.`,
    );
    const notes = notesFor({
      file: `${"very-long-name-".repeat(12)}.mobileconfig`,
      configs: 40,
      signature: "unchecked",
      legacy: true,
      dot: 40,
      mullvad: false,
      leftOut,
    });
    expect(notes.map((note) => note.label)).toEqual([
      "Signature",
      "Format",
      "Protocol",
      "Not carried over",
    ]);
    expect(notes.at(-1)?.value).toBe("40 settings left out");
    expect(notes.at(-1)?.items).toHaveLength(40);
  });

  it("says when nothing was added, on phones too", () => {
    expect(ALREADY_IN_PROFILE).toEqual({
      tone: "info",
      label: "Profile",
      value: "Already in profile",
      text:
        "Nothing was added. The Profile page has the same settings from this file.",
    });
  });

  it("leaves the signature of a file the app checked out", () => {
    expect(
      notesFor({ ...PLAIN, signature: "unknown" }).map((note) => note.label),
    ).toEqual(["Format"]);
  });
});
