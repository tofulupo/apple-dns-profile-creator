#!/usr/bin/env -S deno run --env-file=.env --allow-env=INDEXNOW_KEY --allow-net=apple.mobileconfig.deno.net,api.indexnow.org
/**
 * Tells IndexNow search engines (Bing, Yandex, Seznam, Naver...) that the
 * site's pages changed, so they re-crawl them soon.
 *
 *   deno task indexnow            submit every page
 *   deno task indexnow --dry-run  show what would be sent
 *
 * For the public instance only, not something self-hosters need.
 *
 * Setup: on Deno Deploy, set INDEXNOW_KEY for the Build context; the build
 * then publishes `<key>.txt` on the site (builds without it skip the file).
 * Locally, put the same key in the shell or a gitignored .env. The key is
 * public by design, since search engines read it from the site, but it stays
 * out of the repository.
 *
 * Run it after a deployment that changed what the pages say, not after every
 * push. If SITE_URL moves to another host, update this task's --allow-net
 * hosts in deno.json too.
 */
import { PAGES, SITE_URL } from "../pages/pages.ts";
import { indexNowKeyFile, pageUrl } from "./build.ts";

const ENDPOINT = "https://api.indexnow.org/indexnow";

export interface IndexNowSubmission {
  readonly host: string;
  readonly key: string;
  readonly keyLocation: string;
  readonly urlList: readonly string[];
}

export function submission(key: string): IndexNowSubmission {
  const file = indexNowKeyFile(key);
  return {
    host: new URL(SITE_URL).host,
    key: file.content,
    keyLocation: new URL(file.name, SITE_URL).href,
    urlList: PAGES.map(pageUrl),
  };
}

/** What each IndexNow status means, from https://www.indexnow.org/documentation. */
function explain(status: number): string {
  switch (status) {
    case 200:
    case 202:
      return "accepted";
    case 400:
      return "bad request";
    case 403:
      return "the key file did not match the key";
    case 422:
      return "the URLs do not belong to the host, or the key is invalid";
    case 429:
      return "too many requests, try again later";
    default:
      return "unexpected response";
  }
}

async function main(): Promise<void> {
  const key = Deno.env.get("INDEXNOW_KEY")?.trim();
  if (key === undefined || key === "") {
    throw new Error(
      "Set INDEXNOW_KEY (in the shell or .env) to the key configured on Deno Deploy.",
    );
  }
  const body = submission(key);

  if (Deno.args.includes("--dry-run")) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  // Search engines check the key file right away, so a submission before the
  // deployment that publishes it would only be rejected.
  const published = await fetch(body.keyLocation);
  const text = (await published.text()).trim();
  if (!published.ok || text !== body.key) {
    throw new Error(
      `${body.keyLocation} is not live with this key (HTTP ${published.status}). ` +
        "Set INDEXNOW_KEY for the Build context on Deno Deploy and redeploy.",
    );
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const verdict = `HTTP ${response.status}: ${explain(response.status)}`;
  if (!response.ok) {
    throw new Error(`IndexNow refused the submission, ${verdict}.`);
  }
  console.log(`Submitted ${body.urlList.length} URLs to IndexNow, ${verdict}.`);
  for (const url of body.urlList) console.log(`  ${url}`);
}

if (import.meta.main) await main();
