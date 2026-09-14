/**
 * LIFEPATH-PHASE1-WS3 (test support): resolves every `.css` specifier to an
 * empty in-memory module so node tests can import Vite-bundled components
 * that carry their own `import "./x.css"` side effect.
 */
export function resolve(specifier, context, nextResolve) {
  if (typeof specifier === "string" && specifier.endsWith(".css")) {
    return {
      url: "data:text/javascript,export default undefined;",
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
