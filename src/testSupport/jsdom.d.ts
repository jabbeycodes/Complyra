/**
 * Minimal typings for the jsdom package (a devDependency with no bundled
 * type declarations), covering only what the DOM component tests use.
 * jsdom's window is the standard DOM Window, so it is typed as such.
 */
declare module "jsdom" {
  export interface JSDOMOptions {
    pretendToBeVisual?: boolean;
    url?: string;
    [key: string]: unknown;
  }
  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions);
    readonly window: Window & typeof globalThis;
  }
}
