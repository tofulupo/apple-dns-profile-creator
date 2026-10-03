import { importProfileXml, type ProfileImport } from "../lib/import.ts";

export const DEPRECATED_FORMAT_NOTE =
  "Classic DNS payload, deprecated by Apple but still working on iOS/macOS 27 and later. Use the Declaration format instead.";

export async function readProfileFile(file: File): Promise<ProfileImport> {
  const result = importProfileXml(await file.text());
  if (result.configs.length === 0) {
    throw new Error("That profile contains no DNS settings.");
  }
  return result.usesDeprecatedPayload
    ? { ...result, warnings: [DEPRECATED_FORMAT_NOTE, ...result.warnings] }
    : result;
}

export function uploadError(error: unknown): string {
  return error instanceof Error ? error.message : "Could not read that file.";
}

function isInside(zone: HTMLElement, event: Event): boolean {
  return event.target instanceof Node && zone.contains(event.target);
}

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") === true;
}

export function enableDrop(
  zone: HTMLElement,
  onFile: (file: File) => void,
): void {
  let depth = 0;

  const reset = (): void => {
    depth = 0;
    zone.classList.remove("zone--over");
  };

  zone.addEventListener("dragenter", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth += 1;
    zone.classList.add("zone--over");
  });

  zone.addEventListener("dragover", (event) => {
    if (!carriesFiles(event) || event.dataTransfer === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  zone.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) reset();
  });

  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    reset();
    const file = event.dataTransfer?.files[0];
    if (file !== undefined) onFile(file);
  });

  document.addEventListener("dragover", (event) => {
    if (!carriesFiles(event) || event.dataTransfer === null) return;
    if (isInside(zone, event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "none";
  });
  document.addEventListener("drop", (event) => {
    if (!isInside(zone, event)) event.preventDefault();
  });
}
