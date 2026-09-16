#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-net --allow-env
// Serves dist/ on the LAN. Pass --watch to rebuild on source changes.
import { serveDir } from "@std/http/file-server";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { build } from "./build.ts";

const ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const DEFAULT_PORT = 5173;
const SOURCES = ["src", "css", "index.html", "finalize.html"];

function port(): number {
  const raw = Deno.env.get("DNS_TOOL_PORT");
  if (raw === undefined) return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`DNS_TOOL_PORT is not a valid port: ${raw}`);
  }
  return parsed;
}

function tls(): { cert: string; key: string } | undefined {
  const certPath = Deno.env.get("DNS_TOOL_TLS_CERT");
  const keyPath = Deno.env.get("DNS_TOOL_TLS_KEY");

  if (certPath === undefined && keyPath === undefined) return undefined;
  if (certPath === undefined || keyPath === undefined) {
    throw new Error(
      "Set both DNS_TOOL_TLS_CERT and DNS_TOOL_TLS_KEY, or neither",
    );
  }

  return {
    cert: Deno.readTextFileSync(certPath),
    key: Deno.readTextFileSync(keyPath),
  };
}

let building = false;
let queued = false;

async function rebuild(): Promise<void> {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  try {
    await build();
    console.log("rebuilt");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  } finally {
    building = false;
    if (queued) {
      queued = false;
      await rebuild();
    }
  }
}

async function watch(): Promise<void> {
  const watcher = Deno.watchFs(SOURCES.map((path) => join(ROOT, path)));
  let timer: number | undefined;
  for await (const _event of watcher) {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 50);
  }
}

await build();
if (Deno.args.includes("--watch")) void watch();

const certificate = tls();
Deno.serve({
  hostname: "0.0.0.0",
  port: port(),
  ...(certificate ?? {}),
}, (request) => serveDir(request, { fsRoot: DIST, quiet: true }));
