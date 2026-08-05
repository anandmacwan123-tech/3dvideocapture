/* ============================================================
   exporters.js — SVG, PNG and plain text.

   SVG has two modes. "Outlines" walks the glyph data shipped in
   fonts/glyphs.json and writes real paths, so the file opens
   identically in Illustrator, Figma or a browser with no font
   installed. "Live text" embeds the font as a data URI instead,
   which keeps the letters editable.
   ============================================================ */

import { state, FONT_FAMILY, CAP_RATIO, UPM } from "./state.js";
import { geometry, baselineFor, lettersMarkup, esc } from "./render.js";

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
    const res = await fetch("fonts/HelveticaNowDisplay-Bold.woff2");
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
    ground: st.transparent ? "" : `<rect width="${g.w}" height="${g.h}" fill="${esc(st.bg)}"/>`,
  };
}

async function outlinedLetters(st) {
  const data = await glyphs();
  const upm = data.unitsPerEm || UPM;
  const s = st.fontSize / upm;
  const g = geometry(st);

  /* group runs of the same colour so the file stays tidy in a
     layers panel rather than exploding into one node per letter */
  const byColour = new Map();

  for (const [k, cell] of Object.entries(st.cells)) {
    const [r, c] = k.split(":").map(Number);
    if (r >= st.rows || c >= st.cols) continue;

    const glyph = data.glyphs[cell.ch] || data.glyphs[cell.ch.toUpperCase()];
    if (!glyph || !glyph.d) continue;

    const cx = g.x0 + c * st.cellW + st.cellW / 2;
    const left = cx - (glyph.aw * s) / 2;      // centred on the advance width
    const base = baselineFor(st, r);

    /* font units are y-up, SVG is y-down, hence the negative y scale */
    const node =
      `<path transform="translate(${round(left)} ${round(base)}) scale(${s.toFixed(6)} ${(-s).toFixed(6)})" ` +
      `d="${glyph.d}"/>`;

    const colour = cell.color;
    if (!byColour.has(colour)) byColour.set(colour, []);
    byColour.get(colour).push(node);
  }

  let out = "";
  for (const [colour, nodes] of byColour) {
    out += `<g fill="${esc(colour)}">${nodes.join("")}</g>`;
  }
  return out;
}

export async function toSVG({ outline = true } = {}) {
  const st = state;
  const { open, ground } = header(st);

  if (outline) {
    return `${open}${ground}${await outlinedLetters(st)}</svg>`;
  }

  const uri = await fontDataUri();
  const face =
    `<defs><style>@font-face{font-family:"${FONT_FAMILY}";font-weight:700;font-style:normal;` +
    `src:url(${uri}) format("woff2");}</style></defs>`;

  return (
    `${open}${face}${ground}` +
    `<g font-family="${FONT_FAMILY}, Helvetica, Arial, sans-serif" font-weight="700" ` +
    `font-size="${st.fontSize}" text-anchor="middle">${lettersMarkup(st)}</g></svg>`
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

  await document.fonts.load(`700 ${st.fontSize}px "${FONT_FAMILY}"`);
  await document.fonts.ready;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(g.w * scale));
  canvas.height = Math.max(1, Math.round(g.h * scale));

  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  if (!st.transparent) {
    ctx.fillStyle = st.bg;
    ctx.fillRect(0, 0, g.w, g.h);
  }

  ctx.font = `700 ${st.fontSize}px "${FONT_FAMILY}", Helvetica, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  for (const [k, cell] of Object.entries(st.cells)) {
    const [r, c] = k.split(":").map(Number);
    if (r >= st.rows || c >= st.cols) continue;
    ctx.fillStyle = cell.color;
    ctx.fillText(cell.ch, g.x0 + c * st.cellW + st.cellW / 2, baselineFor(st, r));
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
    for (let c = 0; c < st.cols; c++) line += st.cells[`${r}:${c}`]?.ch ?? " ";
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
