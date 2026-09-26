// Deno 2.9.7 implements `Deno.BrowserWindow` but ships no type declarations for
// it (checked with `deno types`). Only what desktop.ts uses is declared, after
// https://docs.deno.com/runtime/desktop/windows/. Delete this file once Deno
// ships the real types.
declare namespace Deno {
  interface BrowserWindowOptions {
    title?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    resizable?: boolean;
  }

  /** Fires `resize`, `move`, `focus`, `blur` and `close`, among others. */
  class BrowserWindow extends EventTarget {
    constructor(options?: BrowserWindowOptions);
    bind(name: string, handler: (...args: never[]) => unknown): void;
    unbind(name: string): void;
    close(): void;
    setTitle(title: string): void;
    /** Width and height in logical pixels. */
    getSize(): [width: number, height: number];
  }
}
