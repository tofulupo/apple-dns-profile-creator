/** "unknown" is the app: it checked the signature, but doesn't say how. */
export type Signature = "none" | "unchecked" | "unknown";

/** What loading a file found, kept for the Profile page after an import. */
export interface FileFacts {
  readonly file: string;
  readonly configs: number;
  readonly signature: Signature;
  readonly legacy: boolean;
  /** How many of its configurations use DNS over TLS. */
  readonly dot: number;
  /** Any of its configurations uses one of Mullvad's servers. */
  readonly mullvad: boolean;
  readonly leftOut: readonly string[];
}

/** The day Mullvad's public encrypted DNS stops, as Mullvad announced it. */
export const MULLVAD_SHUTDOWN = "2026-11-02";

export function onMullvad(serverUrl: string): boolean {
  const value = serverUrl.trim();
  let host = value;
  try {
    host = new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    // Not a URL: compare the text as it is.
  }
  host = host.toLowerCase();
  return host === "mullvad.net" || host.endsWith(".mullvad.net");
}

function localDate(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${
    pad(now.getDate())
  }`;
}

export type NoteTone = "warning" | "info" | "ok" | "neutral";

export interface NoteAction {
  readonly id: "use-declarations" | "undo-declarations";
  readonly label: string;
  readonly hint?: string;
  /** Drawn as a link, not a button. */
  readonly quiet?: boolean;
}

export interface Note {
  readonly tone: NoteTone;
  readonly label: string;
  readonly value: string;
  readonly text?: string;
  readonly items?: readonly string[];
  readonly action?: NoteAction;
  /** Only reports a state; phones leave it out. */
  readonly calm?: boolean;
}

function signatureNote(signature: Signature): Note | undefined {
  switch (signature) {
    case "unchecked":
      return {
        tone: "warning",
        label: "Signature",
        value: "Not checked",
        text: "Browsers can't verify the signature or its certificate chain.",
      };
    case "none":
      return {
        tone: "neutral",
        label: "Signature",
        value: "Not signed",
        text: "Shown as “Not Signed” when installing.",
        calm: true,
      };
    case "unknown":
      return undefined;
  }
}

function formatNote(legacy: boolean, declarations: boolean): Note {
  if (legacy && declarations) {
    return {
      tone: "ok",
      label: "Format",
      value: "Declaration format on",
      text:
        "Replaces the file's legacy payload in your download. Needs OS 26+.",
      action: { id: "undo-declarations", label: "Undo", quiet: true },
    };
  }
  return legacy
    ? {
      tone: "info",
      label: "Format",
      value: "Legacy payload",
      text: "Deprecated by Apple, still works on OS 27+.",
      action: {
        id: "use-declarations",
        label: "Use Declaration format",
        hint: "OS 26+",
      },
    }
    : {
      tone: "ok",
      label: "Format",
      value: "Declarations",
      text: "Apple's current format, OS 26+.",
      calm: true,
    };
}

/** Also under the URL field in pages/index.html; a test checks both. */
export const DOT_NOTE =
  "DoH blends in with normal HTTPS; DoT is easier to detect and block.";

function protocolNote(dot: number, configs: number): Note | undefined {
  if (dot === 0) return undefined;
  return {
    tone: "info",
    label: "Protocol",
    value: configs === 1
      ? "DNS over TLS"
      : `${dot} of ${configs} use DNS over TLS`,
    text: DOT_NOTE,
  };
}

function leftOutNote(leftOut: readonly string[]): Note | undefined {
  if (leftOut.length === 0) return undefined;
  return {
    tone: "warning",
    label: "Not carried over",
    value: leftOut.length === 1
      ? "1 setting left out"
      : `${leftOut.length} settings left out`,
    items: leftOut,
  };
}

export const ALREADY_IN_PROFILE: Note = {
  tone: "info",
  label: "Profile",
  value: "Already in profile",
  text:
    "Nothing was added. The Profile page has the same settings from this file.",
};

function mullvadNote(mullvad: boolean, now: Date): Note | undefined {
  if (!mullvad) return undefined;
  const over = localDate(now) >= MULLVAD_SHUTDOWN;
  return over
    ? {
      tone: "warning",
      label: "Mullvad",
      value: "Stopped on 2 November 2026",
      text: "Mullvad shut down its encrypted DNS. Pick another resolver, " +
        "like Quad9. Your rules stay.",
    }
    : {
      tone: "info",
      label: "Mullvad",
      value: "Stops on 2 November 2026",
      text: "Mullvad is shutting down its encrypted DNS. Pick another " +
        "resolver, like Quad9. Your rules stay.",
    };
}

/** `declarations` is the Download switch for the Declaration format. */
export function notesFor(
  facts: FileFacts,
  declarations = false,
  now = new Date(),
): Note[] {
  return [
    mullvadNote(facts.mullvad, now),
    signatureNote(facts.signature),
    formatNote(facts.legacy, declarations),
    protocolNote(facts.dot, facts.configs),
    leftOutNote(facts.leftOut),
  ].filter((note) => note !== undefined);
}
