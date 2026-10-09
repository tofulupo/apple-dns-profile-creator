import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { TARGETS } from "../../scripts/desktop_release.ts";
import {
  capabilityPermissions,
  cspDirectives,
  files,
  linesMatching,
  rustDependencies,
} from "../helpers/scan.ts";

const HTTP_CLIENTS = [
  "attohttpc",
  "awc",
  "curl",
  "h2",
  "hyper",
  "isahc",
  "reqwest",
  "surf",
  "tokio-tungstenite",
  "tungstenite",
  "ureq",
];

describe("the app makes no network requests", () => {
  it("lets the pages connect only to the app itself", () => {
    const csp = cspDirectives();
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("connect-src")).toEqual(["ipc:", "http://ipc.localhost"]);
  });

  it("grants the pages no network access", () => {
    expect(
      capabilityPermissions().filter((permission) =>
        /^(http|websocket|upload|localhost):/.test(permission)
      ),
    ).toEqual([]);
  });

  for (const { rust: target } of TARGETS) {
    it(`builds no HTTP client into the app for ${target}`, () => {
      expect(
        rustDependencies(target).filter((name) => HTTP_CLIENTS.includes(name)),
      ).toEqual([]);
    });
  }

  it("has no page code that makes a request", () => {
    expect(
      linesMatching(
        files("src", [".ts"]),
        /\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection|\bimport\(/,
      ),
    ).toEqual([]);
  });

  it("loads no page code from outside the app", () => {
    expect(
      linesMatching(
        files("src", [".ts"]),
        // An import or export whose specifier isn't a relative path.
        /\bfrom\s+"(?!\.\.?\/)[^"]*";?\s*$|^\s*import\s+"(?!\.\.?\/)/,
      ),
    ).toEqual([]);
  });
});
