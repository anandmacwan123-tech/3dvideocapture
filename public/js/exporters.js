/* ============================================================
   exporters.js — SVG, PNG and plain text.

   SVG has two modes. "Outlines" walks the glyph data shipped in
   fonts/glyphs.json and writes real paths, so the file opens
   identically in Illustrator, Figma or a browser with no font
   installed. "Live text" embeds the font as a data URI instead,
   which keeps the letters editable.
   ============================================================ */

import { state, FONT_FAMILY, FONT_STACK, EXPORT_STACK, FONT_WEIGHT, CAP_RATIO, UPM } from "./state.js";
import { geometry, baselineFor, lettersMarkup } from "./render.js";
import { paint } from "./theme.js";

let glyphCache = null;
let fontDataCache = null;

async function glyphs() {
  if (!glyphCache) {
    const res = await fetch("fonts/glyphs.json");
    if (!res.ok) throw new Error("Could not load the outline data.");
    glyphCache = await res.json();
  }
  return glyphCache;
}

async function fontDataUri() {
  if (!fontDataCache) {
    const res = await fetch("fonts/display.woff2");
    if (!res.ok) throw new Error("Could not load the font.");
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
    }
    fontDataCache = `data:font/woff2;base64,${btoa(bin)}`;
  }
  return fontDataCache;
}

const round = (v) => Math.round(v * 100) / 100;

/* ── SVG ───────────────────────────────────────────────────── */

function header(st) {
  const g = geometry(st);
  return {
    g,
    open:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${g.w}" height="${g.h}" ` +
      `viewBox="0 0 ${g.w} ${g.h}">`,
    ground: st.transparent ? "" : `<rect width="${g.w}" height="${g.h}" fill="${paint.ground}"/>`,
  };
}

async function outlinedLetters(st) {
  const data = await glyphs();
  const upm = data.unitsPerEm || UPM;
  const s = st.fontSize / upm;
  const g = geometry(st);

  const nodes = [];

  for (const [k, ch] of Object.entries(st.cells)) {
    const [r, c] = k.split(":").map(Number);
    if (r >= st.rows || c >= st.cols) continue;

    const glyph = data.glyphs[ch] || data.glyphs[ch.toUpperCase()];
    if (!glyph || !glyph.d) continue;

    const cx = g.x0 + c * st.cellW + st.cellW / 2;
    const left = cx - (glyph.aw * s) / 2;      // centred on the advance width
    const base = baselineFor(st, r);

    /* font units are y-up, SVG is y-down, hence the negative y scale */
    nodes.push(
      `<path transform="translate(${round(left)} ${round(base)}) scale(${s.toFixed(6)} ${(-s).toFixed(6)})" ` +
      `d="${glyph.d}"/>`
    );
  }

  return `<g fill="${paint.ink}">${nodes.join("")}</g>`;
}

export async function toSVG({ outline = true } = {}) {
  const st = state;
  const { open, ground } = header(st);

  if (outline) {
    return `${open}${ground}${await outlinedLetters(st)}</svg>`;
  }

  /* embedded under the real family name, not the app's alias, so the file
     still resolves in a viewer that happens to have the font installed */
  const uri = await fontDataUri();
  const face =
    `<defs><style>@font-face{font-family:"${FONT_FAMILY}";font-weight:${FONT_WEIGHT};font-style:normal;` +
    `src:url(${uri}) format("woff2");}</style></defs>`;

  return (
    `${open}${face}${ground}` +
    `<g font-family='${EXPORT_STACK}' font-weight="${FONT_WEIGHT}" ` +
    `font-size="${st.fontSize}" text-anchor="middle" fill="${paint.ink}">${lettersMarkup(st)}</g></svg>`
  );
}

/* ── PNG ───────────────────────────────────────────────────── */

/**
 * Drawn straight onto a canvas rather than via an SVG round-trip:
 * the font is already loaded in the document, so the raster matches
 * the screen exactly.
 */
export async function toPNGBlob(scale = 2) {
  const st = state;
  const g = geometry(st);

  await document.fonts.load(`${FONT_WEIGHT} ${st.fontSize}px "Display"`);
  await document.fonts.ready;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(g.w * scale));
  canvas.height = Math.max(1, Math.round(g.h * scale));

  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  if (!st.transparent) {
    ctx.fillStyle = paint.ground;
    ctx.fillRect(0, 0, g.w, g.h);
  }

  ctx.font = `${FONT_WEIGHT} ${st.fontSize}px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = paint.ink;

  for (const [k, ch] of Object.entries(st.cells)) {
    const [r, c] = k.split(":").map(Number);
    if (r >= st.rows || c >= st.cols) continue;
    ctx.fillText(ch, g.x0 + c * st.cellW + st.cellW / 2, baselineFor(st, r));
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not render the PNG."))), "image/png");
  });
}

export function pngDimensions(scale) {
  const g = geometry(state);
  return `${Math.round(g.w * scale)} × ${Math.round(g.h * scale)} px`;
}

/* ── text ──────────────────────────────────────────────────── */

export function toText() {
  const st = state;
  const lines = [];
  for (let r = 0; r < st.rows; r++) {
    let line = "";
    for (let c = 0; c < st.cols; c++) line += st.cells[`${r}:${c}`] ?? " ";
    lines.push(line.replace(/\s+$/, ""));
  }
  while (lines.length && lines.at(-1) === "") lines.pop();
  return lines.join("\n");
}

/* ── download plumbing ─────────────────────────────────────── */

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export { CAP_RATIO };
