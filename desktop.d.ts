// Deno 2.9.6 implements `Deno.BrowserWindow` but ships no type declarations for
// it, delete this file once Deno ships the real types.
declare namespace Deno {
  interface BrowserWindowOptions {
    title?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    resizable?: boolean;
  }

  class BrowserWindow {
    constructor(options?: BrowserWindowOptions);
    bind(name: string, handler: (...args: never[]) => unknown): void;
    unbind(name: string): void;
    close(): void;
    setTitle(title: string): void;
  }
}
