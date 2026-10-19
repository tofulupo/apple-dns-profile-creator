#!/usr/bin/env -S deno run --allow-net
/**
 * Deno Deploy's entrypoint (`deploy` in deno.json) until it shuts down: every
 * request on apple.mobileconfig.deno.net goes to the same path and query on
 * the site. `deno task check:live` checks it ("Deno Deploy redirect").
 */
import { SITE_URL } from "../pages/pages.ts";

const ORIGIN = new URL(SITE_URL).origin;

export function redirect(request: Request): Response {
  const { pathname, search } = new URL(request.url);
  return new Response(null, {
    status: 301,
    headers: { Location: ORIGIN + pathname + search },
  });
}

if (import.meta.main) {
  Deno.serve(redirect);
}
