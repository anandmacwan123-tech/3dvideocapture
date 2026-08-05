/* ============================================================
   render.js — draws the board as SVG.

   One code path produces both what you see and what you export;
   the guides, cursor and selection are simply layers the exporter
   leaves out.
   ============================================================ */

import { state, ui, FONT_STACK, FONT_WEIGHT, CAP_RATIO, currentWord, clueNumbers } from "./state.js";
import { paint } from "./theme.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export function geometry(st = state) {
  return {
    x0: st.pad,
    y0: st.pad,
    w: st.pad * 2 + st.cols * st.cellW,
    h: st.pad * 2 + st.rows * st.cellH,
  };
}

/** Centre of a cell in board coordinates. */
export function cellCentre(st, r, c) {
  const g = geometry(st);
  return {
    cx: g.x0 + c * st.cellW + st.cellW / 2,
    cy: g.y0 + r * st.cellH + st.cellH / 2,
  };
}

/**
 * Baseline for a capital letter that is optically centred in its cell:
 * drop half the cap height below the cell's middle.
 */
export function baselineFor(st, r) {
  const g = geometry(st);
  return g.y0 + r * st.cellH + st.cellH / 2 + (CAP_RATIO * st.fontSize) / 2 + st.baseline;
}

/** Board coordinates → cell, unclamped. */
export function cellAt(st, x, y) {
  const g = geometry(st);
  return {
    r: Math.floor((y - g.y0) / st.cellH),
    c: Math.floor((x - g.x0) / st.cellW),
  };
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

/* ── layers ────────────────────────────────────────────────── */

function guidesPath(st) {
  const g = geometry(st);
  const x1 = g.x0 + st.cols * st.cellW;
  const y1 = g.y0 + st.rows * st.cellH;
  let d = "";
  for (let c = 0; c <= st.cols; c++) {
    const x = g.x0 + c * st.cellW;
    d += `M${x} ${g.y0}V${y1}`;
  }
  for (let r = 0; r <= st.rows; r++) {
    const y = g.y0 + r * st.cellH;
    d += `M${g.x0} ${y}H${x1}`;
  }
  return d;
}

/**
 * The letters — the only layer that survives into an export.
 * Rounded to 2dp so the markup stays readable and small.
 * Colour is set once on the parent group, not per letter.
 */
export function lettersMarkup(st) {
  const g = geometry(st);
  const n = (v) => Math.round(v * 100) / 100;
  let out = "";
  for (const [k, ch] of Object.entries(st.cells)) {
    const [r, c] = k.split(":").map(Number);
    if (r >= st.rows || c >= st.cols) continue;
    const x = n(g.x0 + c * st.cellW + st.cellW / 2);
    const y = n(baselineFor(st, r));
    out += `<text x="${x}" y="${y}">${esc(ch)}</text>`;
  }
  return out;
}

function numbersMarkup(st) {
  const g = geometry(st);
  const size = Math.max(6, Math.min(st.fontSize * 0.34, st.cellH * 0.3));
  let out = "";
  for (const [k, num] of clueNumbers()) {
    const [r, c] = k.split(":").map(Number);
    const x = g.x0 + c * st.cellW + st.cellW * 0.08;
    const y = g.y0 + r * st.cellH + size + st.cellH * 0.04;
    out += `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${size.toFixed(2)}" ` +
           `font-family="system-ui, sans-serif" font-weight="400" fill="${paint.number}" text-anchor="start">${num}</text>`;
  }
  return out;
}

function rect(r0, c0, r1, c1, st, attrs) {
  const g = geometry(st);
  const x = g.x0 + c0 * st.cellW;
  const y = g.y0 + r0 * st.cellH;
  const w = (c1 - c0 + 1) * st.cellW;
  const h = (r1 - r0 + 1) * st.cellH;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${attrs}/>`;
}

/* ── the on-screen board ───────────────────────────────────── */

export function render(board) {
  const st = state;
  const g = geometry(st);
  const scale = st.zoom / 100;

  board.setAttribute("viewBox", `0 0 ${g.w} ${g.h}`);
  board.setAttribute("width", Math.max(1, Math.round(g.w * scale)));
  board.setAttribute("height", Math.max(1, Math.round(g.h * scale)));

  const ground = st.transparent ? "" : `<rect width="${g.w}" height="${g.h}" fill="${paint.ground}"/>`;

  const guides = st.guides
    ? `<path d="${guidesPath(st)}" stroke="${paint.guide}" stroke-width="1" fill="none" vector-effect="non-scaling-stroke"/>`
    : "";

  /* current word first, then the cursor cell on top of it */
  let cursorLayer = "";
  if (!ui.selection) {
    const w = currentWord();
    if (w.r0 !== w.r1 || w.c0 !== w.c1) {
      cursorLayer += rect(w.r0, w.c0, w.r1, w.c1, st, `fill="${paint.word}"`);
    }
    cursorLayer += rect(ui.cursor.r, ui.cursor.c, ui.cursor.r, ui.cursor.c, st,
      `fill="${paint.cursor}"`);

    /* a thin bar on the leading edge shows which way typing will run */
    const cx = g.x0 + ui.cursor.c * st.cellW;
    const cy = g.y0 + ui.cursor.r * st.cellH;
    cursorLayer += ui.dir === "across"
      ? `<rect x="${cx + st.cellW - 2}" y="${cy}" width="2" height="${st.cellH}" fill="${paint.caret}"/>`
      : `<rect x="${cx}" y="${cy + st.cellH - 2}" width="${st.cellW}" height="2" fill="${paint.caret}"/>`;
  }

  const selectionLayer = ui.selection
    ? rect(ui.selection.r0, ui.selection.c0, ui.selection.r1, ui.selection.c1, st,
        `fill="${paint.word}" stroke="${paint.caret}" stroke-width="1" vector-effect="non-scaling-stroke"`)
    : "";

  board.innerHTML =
    ground +
    guides +
    cursorLayer +
    selectionLayer +
    (st.numbers ? numbersMarkup(st) : "") +
    `<g font-family='${FONT_STACK}' font-weight="${FONT_WEIGHT}" ` +
    `font-size="${st.fontSize}" text-anchor="middle" fill="${paint.ink}">${lettersMarkup(st)}</g>`;
}

export { esc, SVG_NS };
