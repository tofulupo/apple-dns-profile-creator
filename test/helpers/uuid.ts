import type { UuidFactory } from "../../src/lib/types.ts";

export interface UuidStub extends UuidFactory {
  readonly calls: readonly string[];
}

export function stubUuid(): UuidStub {
  const calls: string[] = [];
  const next = (): string => {
    const id = `00000000-0000-4000-8000-${
      String(calls.length + 1).padStart(12, "0")
    }`;
    calls.push(id);
    return id;
  };
  return Object.assign(next, { calls }) as UuidStub;
}
