/**
 * A minimal XML reader for the property-list subset.
 */

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlParseError";
  }
}

export interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlElement[];
  readonly text: string;
}

const NAME_CHAR = /[A-Za-z0-9_\-:.]/;
const WHITESPACE = /\s/;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** A code point XML 1.0 allows in a document (the `Char` production). */
function isXmlChar(code: number): boolean {
  return code === 0x9 || code === 0xa || code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff);
}

function decodeEntities(
  text: string,
  fail: (message: string) => never,
): string {
  if (!text.includes("&")) {
    return text;
  }
  // `#[^;]*` is deliberately loose, so that `&#12ab;` is reported below
  // instead of being skipped by the pattern and kept as literal text.
  return text.replace(/&(#[^;&<]*|[A-Za-z]+);/g, (match, body: string) => {
    if (!body.startsWith("#")) {
      return NAMED_ENTITIES[body] ?? match;
    }
    const hex = /^#[xX]([0-9A-Fa-f]+)$/.exec(body)?.[1];
    const decimal = /^#([0-9]+)$/.exec(body)?.[1];
    const code = hex !== undefined
      ? Number.parseInt(hex, 16)
      : decimal !== undefined
      ? Number.parseInt(decimal, 10)
      : undefined;
    if (code === undefined) fail(`Malformed character reference ${match}`);
    if (!isXmlChar(code)) {
      fail(`Character reference ${match} is not an allowed character`);
    }
    return String.fromCodePoint(code);
  });
}

export function parseXml(source: string): XmlElement {
  let i = 0;

  function fail(message: string): never {
    const line = source.slice(0, i).split("\n").length;
    throw new XmlParseError(`${message} (line ${line})`);
  }

  function skipWhitespace(): void {
    while (i < source.length && WHITESPACE.test(source[i]!)) {
      i++;
    }
  }

  function skipDeclaration(): void {
    i += 2;
    let depth = 0;
    while (i < source.length) {
      const char = source[i]!;
      if (char === '"' || char === "'") {
        const end = source.indexOf(char, i + 1);
        if (end < 0) fail("Unterminated string in declaration");
        i = end + 1;
        continue;
      }
      if (char === "[") depth++;
      else if (char === "]") depth--;
      else if (char === ">" && depth <= 0) {
        i++;
        return;
      }
      i++;
    }
    fail("Unterminated declaration");
  }

  function skipMisc(): void {
    for (;;) {
      skipWhitespace();
      if (source.startsWith("<?", i)) {
        const end = source.indexOf("?>", i);
        if (end < 0) fail("Unterminated processing instruction");
        i = end + 2;
        continue;
      }
      if (source.startsWith("<!--", i)) {
        const end = source.indexOf("-->", i);
        if (end < 0) fail("Unterminated comment");
        i = end + 3;
        continue;
      }
      if (source.startsWith("<!", i)) {
        skipDeclaration();
        continue;
      }
      return;
    }
  }

  function readName(): string {
    const start = i;
    while (i < source.length && NAME_CHAR.test(source[i]!)) {
      i++;
    }
    if (i === start) fail("Expected an element or attribute name");
    return source.slice(start, i);
  }

  function parseElement(): XmlElement {
    if (source[i] !== "<") fail("Expected '<'");
    i++;
    const name = readName();
    const attributes: Record<string, string> = {};

    for (;;) {
      skipWhitespace();
      if (source.startsWith("/>", i)) {
        i += 2;
        return { name, attributes, children: [], text: "" };
      }
      if (source[i] === ">") {
        i++;
        break;
      }
      const attribute = readName();
      skipWhitespace();
      if (source[i] !== "=") {
        fail(`Expected '=' after attribute '${attribute}'`);
      }
      i++;
      skipWhitespace();
      const quote = source[i];
      if (quote !== '"' && quote !== "'") {
        fail(`Expected a quoted value for attribute '${attribute}'`);
      }
      i++;
      const end = source.indexOf(quote, i);
      if (end < 0) fail(`Unterminated value for attribute '${attribute}'`);
      attributes[attribute] = decodeEntities(source.slice(i, end), fail);
      i = end + 1;
    }

    const children: XmlElement[] = [];
    let text = "";

    for (;;) {
      if (i >= source.length) fail(`Unclosed element <${name}>`);

      if (source.startsWith("</", i)) {
        i += 2;
        const closing = readName();
        if (closing !== name) {
          fail(`Mismatched closing tag </${closing}>, expected </${name}>`);
        }
        skipWhitespace();
        if (source[i] !== ">") fail(`Malformed closing tag for <${name}>`);
        i++;
        return { name, attributes, children, text };
      }

      if (source.startsWith("<!--", i)) {
        const end = source.indexOf("-->", i);
        if (end < 0) fail("Unterminated comment");
        i = end + 3;
        continue;
      }

      if (source.startsWith("<![CDATA[", i)) {
        const end = source.indexOf("]]>", i);
        if (end < 0) fail("Unterminated CDATA section");
        text += source.slice(i + 9, end);
        i = end + 3;
        continue;
      }

      if (source[i] === "<") {
        children.push(parseElement());
        continue;
      }

      const next = source.indexOf("<", i);
      const chunk = next < 0 ? source.slice(i) : source.slice(i, next);
      text += decodeEntities(chunk, fail);
      i = next < 0 ? source.length : next;
    }
  }

  skipMisc();
  if (i >= source.length) fail("Document contains no root element");
  const root = parseElement();
  skipMisc();
  if (i < source.length) fail("Unexpected content after the root element");
  return root;
}
