import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { files, read } from "../helpers/scan.ts";

const SIGNING = /\bsign(s|ed|ing|ature|atures)?\b/i;
const OVERCLAIM =
  /\b(secure|securely|safe|safely|safer|authentic|authenticity|authenticated|guarantees?|guaranteed)\b/i;

interface Passage {
  readonly where: string;
  readonly text: string;
}

function paragraphs(path: string): Passage[] {
  const passages: Passage[] = [];
  let start = 0;
  let lines: string[] = [];
  read(path).split("\n").forEach((line, index) => {
    if (line.trim() === "") {
      if (lines.length > 0) {
        passages.push({ where: `${path}:${start + 1}`, text: lines.join(" ") });
      }
      lines = [];
    } else {
      if (lines.length === 0) start = index;
      lines.push(line.trim());
    }
  });
  if (lines.length > 0) {
    passages.push({ where: `${path}:${start + 1}`, text: lines.join(" ") });
  }
  return passages;
}

// Double-quoted and template string literals, where the UI texts are.
function strings(path: string): Passage[] {
  return read(path).split("\n").flatMap((line, index) =>
    [...line.matchAll(/"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map(
      (match) => ({
        where: `${path}:${index + 1}`,
        text: match[1] ?? match[2] ?? "",
      }),
    )
  );
}

function overclaims(passages: readonly Passage[]): string[] {
  return passages.flatMap(({ where, text }) =>
    text.split(/(?<=[.!?])\s+/).filter((sentence) =>
      SIGNING.test(sentence) && OVERCLAIM.test(sentence)
    ).map((sentence) => `${where}: ${sentence}`)
  );
}

describe("a signature is never called more than it is", () => {
  it("is never called safe, secure or authentic in the docs", () => {
    const docs = [
      "README.md",
      "CHANGELOG.md",
      "pages/llms.txt",
      ...files("pages", [".html"]),
    ];
    expect(overclaims(docs.flatMap(paragraphs))).toEqual([]);
  });

  it("is never called safe, secure or authentic in the app's texts", () => {
    const code = [...files("src", [".ts"]), ...files("src-tauri/src", [".rs"])];
    expect(overclaims(code.flatMap(strings))).toEqual([]);
  });
});
