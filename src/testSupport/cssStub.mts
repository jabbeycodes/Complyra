/**
 * LIFEPATH-PHASE1-WS3 (test support): no-op loader hook for `.css`
 * side-effect imports so component tests can run under `node --import tsx`
 * (Vite handles the real CSS in the app build; node cannot).
 *
 * Usage: add `--import ./src/testSupport/cssStub.mts` BEFORE `--test` in the
 * package.json test script. It must come after `--import tsx`.
 */
import { register } from "node:module";

register("./cssHooks.mjs", import.meta.url);

export {};
