#!/usr/bin/env -S deno run --allow-run=curl
/**
 * Checks the live website from outside against scripts/headers.ts:
 *
 *   deno task check:live [url] [--ip <address>] [--commit <sha>]
 *     [--no-deno-deploy]
 *
 * --ip sends the requests to that address (curl --resolve), so the server can
 * be checked before DNS points to it. Every request goes through curl.
 */

import { cacheControl, CSP_DIRECTIVES, SECURITY_HEADERS } from "./headers.ts";

export const SITE = "https://mobileconfig.io/";
/** Deno Deploy, which answers with a redirect until it shuts down. */
export const OLD_SITE = "https://apple.mobileconfig.deno.net/";

export interface Result {
  readonly name: string;
  readonly outcome: "ok" | "fail" | "skip";
  readonly detail?: string;
}

export interface Options {
  readonly url: string;
  readonly ip?: string;
  readonly commit?: string;
  readonly denoDeploy?: boolean;
  /** The curl to run; tests change it. */
  readonly curl?: string;
  /** Today, for security.txt's expiry; tests change it. */
  readonly now?: Date;
}

/**
 * security.txt must be renewed before this many days are left: `just setup`
 * in the Ansible repo refuses a file with less.
 */
export const SECURITY_TXT_MIN_DAYS = 30;
const SECURITY_TXT = "/.well-known/security.txt";

/** RFC 9116: Contact and Expires are required, Expires in the future. */
export function securityTxtProblems(
  text: string,
  url: string,
  now: Date,
): { problems: string[]; expires?: Date } {
  const field = (name: string) =>
    [...text.matchAll(new RegExp(`^${name}:\\s*(\\S.*?)\\s*$`, "gim"))]
      .map((match) => match[1]!);
  const problems: string[] = [];
  if (field("Contact").length === 0) problems.push("no Contact");
  const canonical = field("Canonical");
  if (canonical.length > 0 && !canonical.includes(url)) {
    problems.push(`Canonical is not ${url}`);
  }
  const [raw, ...more] = field("Expires");
  if (raw === undefined) return { problems: [...problems, "no Expires"] };
  if (more.length > 0) problems.push("more than one Expires");
  const expires = new Date(raw);
  if (Number.isNaN(expires.getTime())) {
    return { problems: [...problems, `Expires is not a date: "${raw}"`] };
  }
  const days = Math.floor((expires.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) problems.push(`expired on ${raw}`);
  else if (days < SECURITY_TXT_MIN_DAYS) {
    problems.push(
      `expires in ${days} days (${raw}), renew with \`just security-txt\``,
    );
  }
  return { problems, expires };
}

interface Answer {
  readonly status: number;
  readonly headers: Headers;
  readonly body: string;
}

export class CurlMissing extends Error {
  constructor(curl: string) {
    super(`${curl} not found. check:live makes every request with curl.`);
  }
}

class Client {
  readonly #curl: string;
  readonly #resolve: string[];

  constructor(options: Options) {
    this.#curl = options.curl ?? "curl";
    this.#resolve = [];
    if (options.ip !== undefined) {
      const host = new URL(options.url).hostname;
      const address = options.ip.includes(":") ? `[${options.ip}]` : options.ip;
      for (const name of [host, `www.${host}`]) {
        for (const port of [80, 443]) {
          this.#resolve.push("--resolve", `${name}:${port}:${address}`);
        }
      }
    }
  }

  async run(args: string[]): Promise<{ code: number; stdout: string }> {
    try {
      const { code, stdout } = await new Deno.Command(this.#curl, {
        args: [
          "--silent",
          "--max-time",
          "15",
          "--noproxy",
          "localhost,127.0.0.1,::1",
          ...this.#resolve,
          ...args,
        ],
        stdout: "piped",
        stderr: "null",
      }).output();
      return { code, stdout: new TextDecoder().decode(stdout) };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new CurlMissing(this.#curl);
      }
      throw error;
    }
  }

  async request(url: string, method = "GET"): Promise<Answer> {
    const { code, stdout } = await this.run([
      "--include",
      "--compressed",
      "--request",
      method,
      url,
    ]);
    if (code !== 0) throw new Error(`curl ${url} failed (exit ${code})`);
    // Skip interim answers such as 100 Continue.
    const blocks = stdout.split(/\r?\n\r?\n/);
    let index = 0;
    while (/^HTTP\/\S+ 1\d\d/.test(blocks[index] ?? "")) index++;
    const [statusLine = "", ...lines] = (blocks[index] ?? "").split(/\r?\n/);
    const headers = new Headers();
    for (const line of lines) {
      const colon = line.indexOf(":");
      if (colon > 0) {
        headers.append(
          line.slice(0, colon).trim(),
          line.slice(colon + 1).trim(),
        );
      }
    }
    return {
      status: Number(statusLine.split(" ")[1]),
      headers,
      body: blocks.slice(index + 1).join("\n\n"),
    };
  }
}

function attributes(tag: string): Map<string, string> {
  return new Map(
    [...tag.matchAll(/([a-z-]+)(?:\s*=\s*"([^"]*)")?/gi)].slice(1)
      .map((match) => [match[1]!.toLowerCase(), match[2] ?? ""]),
  );
}

function tags(html: string, name: string): Map<string, string>[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))]
    .map((match) => attributes(match[0]));
}

/** What a page links that the server must send with the right headers. */
export function linkedFiles(html: string): string[] {
  const links = tags(html, "link");
  const href = (test: (link: Map<string, string>) => boolean) =>
    links.filter(test).map((link) => link.get("href") ?? "");
  return [
    ...href((link) => link.get("rel") === "stylesheet"),
    ...tags(html, "script").map((script) => script.get("src") ?? "")
      .filter((src) => src !== ""),
    ...href((link) =>
      link.get("rel") === "preload" && link.get("as") === "font"
    )
      .slice(0, 1),
    ...href((link) => link.get("rel") === "manifest"),
    ...href((link) => link.get("rel") === "icon").slice(0, 1),
  ].filter((path) => path !== "");
}

/** Inline scripts the CSP would block; JSON-LD is data and never runs. */
export function inlineScripts(html: string): number {
  return tags(html, "script").filter((script) =>
    !script.has("src") && script.get("type") !== "application/ld+json"
  ).length;
}

function directives(csp: string): Set<string> {
  return new Set(
    csp.split(";").map((directive) => directive.trim().replace(/\s+/g, " "))
      .filter((directive) => directive !== ""),
  );
}

function headerMismatches(answer: Answer, path: string): string[] {
  const found: string[] = [];
  for (const [name, expected] of Object.entries(SECURITY_HEADERS)) {
    const actual = answer.headers.get(name);
    if (name === "Content-Security-Policy") {
      const live = directives(actual ?? "");
      const missing = CSP_DIRECTIVES.filter((d) => !live.has(d));
      const extra = [...live].filter((d) => !CSP_DIRECTIVES.includes(d));
      if (missing.length > 0) found.push(`CSP lacks "${missing.join('", "')}"`);
      if (extra.length > 0) found.push(`CSP has extra "${extra.join('", "')}"`);
    } else if (actual !== expected) {
      found.push(
        `${name}: expected "${expected}", got "${actual ?? "nothing"}"`,
      );
    }
  }
  const cache = cacheControl(path, answer.status);
  const actualCache = answer.headers.get("Cache-Control");
  if (actualCache !== cache) {
    found.push(
      `Cache-Control: expected "${cache}", got "${actualCache ?? "nothing"}"`,
    );
  }
  const server = answer.headers.get("Server");
  if (server !== null && /\d/.test(server)) {
    found.push(`Server shows a version: "${server}"`);
  }
  return found;
}

function outcome(name: string, problems: string[]): Result {
  return problems.length === 0
    ? { name, outcome: "ok" }
    : { name, outcome: "fail", detail: problems.join("; ") };
}

async function attempt(
  name: string,
  check: () => Promise<string[]>,
): Promise<Result> {
  try {
    return outcome(name, await check());
  } catch (error) {
    if (error instanceof CurlMissing) throw error;
    return {
      name,
      outcome: "fail",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkLive(options: Options): Promise<Result[]> {
  const client = new Client(options);
  const site = new URL(options.url);
  const at = (path: string) => new URL(path, site).href;
  const results: Result[] = [];
  let start = "";

  for (const path of ["/", "/finalize.html"]) {
    results.push(
      await attempt(`page ${path}`, async () => {
        const answer = await client.request(at(path));
        if (path === "/") start = answer.body;
        const problems = answer.status === 200
          ? []
          : [`status ${answer.status}, expected 200`];
        problems.push(...headerMismatches(answer, path));
        if (!/accept-encoding/i.test(answer.headers.get("Vary") ?? "")) {
          problems.push("Vary lacks Accept-Encoding");
        }
        const inline = inlineScripts(answer.body);
        if (inline > 0) problems.push(`${inline} inline script(s)`);
        return problems;
      }),
    );
  }

  const files = linkedFiles(start).map((href) => new URL(href, site).pathname);
  if (files.length === 0) {
    results.push({
      name: "linked files",
      outcome: "fail",
      detail: "found no stylesheet, script, font or manifest on /",
    });
  }
  for (const path of files) {
    results.push(
      await attempt(`file ${path}`, async () => {
        const answer = await client.request(at(path));
        const problems = answer.status === 200
          ? []
          : [`status ${answer.status}, expected 200`];
        problems.push(...headerMismatches(answer, path));
        if (/\.(?:css|js)$/.test(path)) {
          if (!/accept-encoding/i.test(answer.headers.get("Vary") ?? "")) {
            problems.push("Vary lacks Accept-Encoding");
          }
          if (
            !/^(br|gzip|zstd)$/.test(
              answer.headers.get("Content-Encoding") ?? "",
            )
          ) {
            problems.push("not compressed");
          }
        }
        return problems;
      }),
    );
  }

  results.push(
    await attempt("unknown path 404", async () => {
      const path = `/check-live-${crypto.randomUUID()}`;
      const answer = await client.request(at(path));
      const problems = answer.status === 404
        ? []
        : [`status ${answer.status}, expected 404`];
      problems.push(...headerMismatches(answer, path));
      if (!answer.body.includes("Page not found")) {
        problems.push("not the site's 404 page");
      }
      return problems;
    }),
    await attempt("POST 405", async () => {
      const answer = await client.request(at("/"), "POST");
      const problems = answer.status === 405
        ? []
        : [`status ${answer.status}, expected 405`];
      const allow = answer.headers.get("Allow");
      if (allow !== "GET, HEAD") {
        problems.push(
          `Allow: expected "GET, HEAD", got "${allow ?? "nothing"}"`,
        );
      }
      return problems;
    }),
  );

  const build = await client.request(at("/build.txt")).catch(() => undefined);
  const live = build?.body.match(/^commit: (\S+)$/m)?.[1];
  results.push(outcome(
    `build.txt${live === undefined ? "" : `, commit ${live}`}`,
    [
      ...(build?.status === 200 && live !== undefined
        ? []
        : ["no build.txt with a commit"]),
      ...(build !== undefined && !/^clean: yes$/m.test(build.body)
        ? ["not built from a clean tree"]
        : []),
      ...(options.commit !== undefined && live !== undefined &&
          !live.startsWith(options.commit) && !options.commit.startsWith(live)
        ? [`expected commit ${options.commit}`]
        : []),
    ],
  ));

  let securityTxt = "security.txt";
  results.push(
    await attempt("security.txt", async () => {
      const answer = await client.request(at(SECURITY_TXT));
      if (answer.status !== 200) {
        return [`status ${answer.status}, expected 200`];
      }
      const problems = headerMismatches(answer, SECURITY_TXT);
      if (!/^text\/plain\b/.test(answer.headers.get("Content-Type") ?? "")) {
        problems.push("not text/plain");
      }
      const now = options.now ?? new Date();
      const found = securityTxtProblems(answer.body, at(SECURITY_TXT), now);
      problems.push(...found.problems);
      if (found.expires !== undefined) {
        const days = Math.floor(
          (found.expires.getTime() - now.getTime()) / 86_400_000,
        );
        const signed =
          answer.body.includes("-----BEGIN PGP SIGNED MESSAGE-----")
            ? ", signed"
            : "";
        securityTxt = `security.txt, expires ${
          found.expires.toISOString().slice(0, 10)
        } (${days} days)${signed}`;
      }
      return problems;
    }).then((result) => ({ ...result, name: securityTxt })),
  );

  if (site.protocol !== "https:") {
    for (const name of ["redirects", "TLS 1.3 only", "Deno Deploy redirect"]) {
      results.push({ name, outcome: "skip", detail: "not an https:// URL" });
    }
    return results;
  }

  results.push(
    await attempt("http:// redirects to https://", async () => {
      const answer = await client.request(`http://${site.host}/finalize.html`);
      const target = `https://${site.host}/finalize.html`;
      return answer.status === 301 && answer.headers.get("Location") === target
        ? []
        : [
          `${answer.status} to ${
            answer.headers.get("Location")
          }, expected 301 to ${target}`,
        ];
    }),
    await attempt("www. redirects to the apex", async () => {
      const answer = await client.request(
        `https://www.${site.host}/finalize.html`,
      );
      const target = `https://${site.host}/finalize.html`;
      return answer.status === 301 && answer.headers.get("Location") === target
        ? []
        : [
          `${answer.status} to ${
            answer.headers.get("Location")
          }, expected 301 to ${target}`,
        ];
    }),
    await attempt("/security.txt redirects to /.well-known/", async () => {
      const answer = await client.request(at("/security.txt"));
      const target = at(SECURITY_TXT);
      return answer.status === 301 && answer.headers.get("Location") === target
        ? []
        : [
          `${answer.status} to ${
            answer.headers.get("Location")
          }, expected 301 to ${target}`,
        ];
    }),
    await attempt("TLS 1.3 only", async () => {
      const old = await client.run([
        "--tlsv1.2",
        "--tls-max",
        "1.2",
        "--head",
        site.href,
      ]);
      const current = await client.run(["--tlsv1.3", "--head", site.href]);
      return [
        ...(old.code === 0 ? ["TLS 1.2 accepted"] : []),
        ...(current.code === 0
          ? []
          : [`TLS 1.3 failed (curl exit ${current.code})`]),
      ];
    }),
  );

  if (options.denoDeploy === false || site.href !== SITE) {
    results.push({
      name: "Deno Deploy redirect",
      outcome: "skip",
      detail: site.href !== SITE ? `not ${SITE}` : "--no-deno-deploy",
    });
  } else {
    results.push(
      await attempt("Deno Deploy redirect", async () => {
        const path = "finalize.html?check=live";
        const answer = await new Client({
          url: OLD_SITE,
          ...(options.curl === undefined ? {} : { curl: options.curl }),
        })
          .request(new URL(path, OLD_SITE).href);
        const target = new URL(path, SITE).href;
        return answer.status === 301 &&
            answer.headers.get("Location") === target
          ? []
          : [
            `${answer.status} to ${
              answer.headers.get("Location")
            }, expected 301 to ${target}`,
          ];
      }),
    );
  }
  return results;
}

export function report(results: readonly Result[]): string {
  return results.map(({ name, outcome, detail }) =>
    `${outcome.padEnd(4)} ${name}${detail === undefined ? "" : `: ${detail}`}`
  ).join("\n");
}

export function parseOptions(args: readonly string[]): Options {
  let url = SITE;
  let ip: string | undefined;
  let commit: string | undefined;
  let denoDeploy = true;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const value = () => {
      const next = args[++index];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--ip") ip = value();
    else if (arg === "--commit") commit = value();
    else if (arg === "--no-deno-deploy") denoDeploy = false;
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else url = new URL(arg).href;
  }
  return {
    url,
    denoDeploy,
    ...(ip === undefined ? {} : { ip }),
    ...(commit === undefined ? {} : { commit }),
  };
}

if (import.meta.main) {
  try {
    const results = await checkLive(parseOptions(Deno.args));
    console.log(report(results));
    Deno.exit(results.some((result) => result.outcome === "fail") ? 1 : 0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(2);
  }
}
