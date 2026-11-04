import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BrandLoader from "./BrandLoader";

// The favicon mark's geometry (public/favicon.svg) — the loader must inline
// exactly these strokes so the animated mark IS the brand mark.
const SHIELD_MAIN = "M55.38 18.5 32 5 8.62 18.5 8.62 45.5 32 59 55.38 45.5";
const SHIELD_TOP = "M32 5 55.38 18.5";
const SHIELD_BOTTOM = "M32 59 55.38 45.5";
const CHECK = "M22.5 31l5.5 6 12-14";

describe("BrandLoader", () => {
  it("renders the inlined favicon mark: cream tile, three shield segments, check", () => {
    const html = renderToStaticMarkup(<BrandLoader />);
    assert.ok(html.includes('fill="#e8dcc8"'), "cream tile");
    assert.ok(html.includes(SHIELD_MAIN), "main shield segment");
    assert.ok(html.includes(SHIELD_TOP), "top-right shield segment");
    assert.ok(html.includes(SHIELD_BOTTOM), "bottom-right shield segment");
    assert.ok(html.includes(CHECK), "check mark");
    assert.ok(html.includes('stroke="#3f5c3b"'), "main segment green");
    assert.ok(html.includes('stroke="#6f815c"'), "top segment green");
    assert.ok(html.includes('stroke="#2f4630"'), "bottom segment green");
    assert.ok(html.includes('stroke="#8b5e3c"'), "check brown");
    assert.ok(!html.includes("<img"), "mark is inline SVG, never an <img>");
  });

  it("gives every animated path a pathLength so the CSS draw math is uniform", () => {
    const html = renderToStaticMarkup(<BrandLoader />);
    assert.equal((html.match(/pathLength="100"/g) ?? []).length, 4);
    assert.ok(html.includes("brand-loader-seg--main"));
    assert.ok(html.includes("brand-loader-seg--top"));
    assert.ok(html.includes("brand-loader-seg--bottom"));
    assert.ok(html.includes("brand-loader-check"));
  });

  it("full variant (default) shows the wordmark and the default status", () => {
    const html = renderToStaticMarkup(<BrandLoader />);
    assert.ok(html.includes("brand-loader--full"), "full variant class");
    assert.ok(html.includes("complyrer-word"), "app wordmark style");
    assert.ok(html.includes("Comply"), "wordmark text");
    assert.ok(html.includes('role="status"'), "status is announced");
    assert.ok(html.includes("Loading workspace…"), "default status text");
  });

  it("renders a custom status verbatim", () => {
    const html = renderToStaticMarkup(
      <BrandLoader status="Loading workspace page…" />,
    );
    assert.ok(html.includes("Loading workspace page…"));
    assert.ok(!html.includes(">Loading workspace…<"), "default not used");
  });

  it("compact variant omits the wordmark but keeps mark and status", () => {
    const html = renderToStaticMarkup(
      <BrandLoader variant="compact" status="Loading workspace page…" />,
    );
    assert.ok(html.includes("brand-loader--compact"), "compact variant class");
    assert.ok(!html.includes("complyrer-word"), "no wordmark");
    assert.ok(html.includes(SHIELD_MAIN), "mark still renders");
    assert.ok(html.includes('role="status"'), "status still announced");
    assert.ok(html.includes("Loading workspace page…"));
  });

  it("stylesheet draws with dashoffset, pulses, and honors reduced motion", () => {
    const css = readFileSync(
      join(process.cwd(), "src/components/BrandLoader.css"),
      "utf8",
    );
    assert.ok(css.includes("stroke-dasharray: 100"), "draw setup");
    assert.ok(css.includes("@keyframes brand-loader-draw"), "draw keyframes");
    assert.ok(css.includes("@keyframes brand-loader-breathe"), "pulse loop");
    assert.ok(
      !/(linear|radial|conic)-gradient\(/.test(css),
      "solid colors only, no gradient fills",
    );

    const reduced = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    assert.ok(
      reduced.length > 0,
      "prefers-reduced-motion block exists in the stylesheet",
    );
    assert.ok(reduced.includes("animation: none"), "animations disabled");
    assert.ok(
      reduced.includes("stroke-dashoffset: 0"),
      "mark renders fully drawn (static) under reduced motion",
    );
  });

  it("static markup always carries the complete mark (the reduced-motion render)", () => {
    // SSR markup is what a reduced-motion user ends up with once the media
    // query zeroes the dashoffset: all four strokes present in the DOM.
    const html = renderToStaticMarkup(<BrandLoader variant="compact" />);
    for (const d of [SHIELD_MAIN, SHIELD_TOP, SHIELD_BOTTOM, CHECK]) {
      assert.ok(html.includes(d), `static mark includes ${d.slice(0, 12)}…`);
    }
  });
});

describe("App loading gates use BrandLoader", () => {
  const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");

  it("imports the shared loader", () => {
    assert.ok(app.includes('from "./components/BrandLoader"'));
  });

  it("both login-shell gates render the full loader with their original text", () => {
    const full = app.match(/<BrandLoader status="Loading workspace…" \/>/g);
    assert.equal(full?.length, 2, "two full-variant gates");
    assert.ok(
      !app.includes('className="login-shell">Loading workspace…'),
      "bare login-shell loading text is gone",
    );
  });

  it("the Suspense fallback renders the compact loader with its original text", () => {
    assert.ok(
      app.includes(
        '<BrandLoader variant="compact" status="Loading workspace page…" />',
      ),
    );
    assert.ok(
      !app.includes("Loading workspace page…</p>"),
      "bare Suspense fallback text is gone",
    );
  });
});
