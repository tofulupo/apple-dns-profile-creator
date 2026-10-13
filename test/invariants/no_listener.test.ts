import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { TARGETS } from "../../scripts/desktop_release.ts";
import {
  linesMatching,
  rustCode,
  rustDependencies,
  tauriConfig,
} from "../helpers/scan.ts";

const SERVERS = [
  "actix-web",
  "axum",
  "hyper",
  "rouille",
  "tauri-plugin-localhost",
  "tiny_http",
  "warp",
];

const SOCKET =
  /TcpListener|TcpStream|UdpSocket|UnixListener|std::net|tokio::net|\.bind\(|\.listen\(/;

describe("nothing listens on the network", () => {
  it("configures no server plugin", () => {
    expect(Object.keys(tauriConfig().plugins ?? {})).not.toContain(
      "localhost",
    );
  });

  for (const { rust: target } of TARGETS) {
    it(`builds no server into the app for ${target}`, () => {
      expect(
        rustDependencies(target).filter((name) => SERVERS.includes(name)),
      ).toEqual([]);
    });
  }

  it("has no app code that opens a socket", () => {
    expect(linesMatching(rustCode(), SOCKET)).toEqual([]);
  });

  it("would notice a socket", () => {
    expect(SOCKET.test('let listener = TcpListener::bind("127.0.0.1:0")?;'))
      .toBe(true);
    expect(SOCKET.test("use std::net::UdpSocket;")).toBe(true);
  });
});
