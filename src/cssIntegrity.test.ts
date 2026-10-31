import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Tripwire for the 2026-10-30 production incident: a single missing closing
// brace in mobile.css (lost in a merge composition) made the CSS parser
// swallow every rule after it, leaving the whole desktop app unstyled while
// builds and DOM tests stayed green. Balanced braces per file is the cheap
// invariant that catches the class. Comments and quoted strings are stripped
// before counting so braces inside them never skew the result.
function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.css')) out.push(path);
  }
  return out;
}

function countBraces(css: string): { open: number; close: number } {
  const stripped = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
  let open = 0;
  let close = 0;
  for (const ch of stripped) {
    if (ch === '{') open += 1;
    else if (ch === '}') close += 1;
  }
  return { open, close };
}

test('every stylesheet has balanced braces', () => {
  const srcRoot = join(process.cwd(), 'src');
  const files = cssFiles(srcRoot);
  assert.ok(files.length > 0, 'expected to find stylesheets under src/');
  for (const file of files) {
    const { open, close } = countBraces(readFileSync(file, 'utf8'));
    assert.equal(
      close,
      open,
      `${file.replace(srcRoot, 'src')}: unbalanced braces (open=${open}, close=${close}) — a missing } silently swallows every following rule`,
    );
  }
});
