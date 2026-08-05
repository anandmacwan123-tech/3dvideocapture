/* ============================================================
   state.js — the document, its history, and persistence.

   The document is deliberately tiny: grid dimensions plus a sparse
   map of filled cells. Everything else is presentation.
   ============================================================ */

export const FONT_FAMILY = "Helvetica Now Display";

/* From the font's OS/2 table: capHeight 712 / unitsPerEm 1000.
   Centring on the cap height — not the em box, and not the browser's
   dominant-baseline — is what makes a row of capitals sit optically
   dead centre in its invisible block. */
export const CAP_RATIO = 0.712;
export const UPM = 1000;

const STORAGE_KEY = "crossword.layout.v1";
const HISTORY_LIMIT = 120;

export const LIMITS = {
  cols:      { min: 1,   max: 120 },
  rows:      { min: 1,   max: 120 },
  cellW:     { min: 4,   max: 200 },
  cellH:     { min: 4,   max: 200 },
  fontSize:  { min: 4,   max: 200 },
  baseline:  { min: -50, max: 50  },
  pad:       { min: 0,   max: 400 },
  zoom:      { min: 10,  max: 400 },
};

/* Ink and ground are the theme's, not the document's — see theme.js. */
export const DEFAULTS = {
  cols: 24,
  rows: 16,
  cellW: 34,
  cellH: 34,
  linked: true,
  fontSize: 22,
  baseline: 0,
  upper: true,
  transparent: false,
  pad: 48,
  zoom: 100,
  guides: true,
  numbers: false,
  cells: {},   // "row:col" -> a single character
};

export const key = (r, c) => `${r}:${c}`;

/* ── store ─────────────────────────────────────────────────── */

const listeners = new Set();
let saveTimer = null;

export const state = { ...structuredClone(DEFAULTS) };

export const ui = {
  cursor: { r: 0, c: 0 },
  dir: "across",       // "across" | "down"
  selection: null,     // { r0, c0, r1, c1 } — normalised
};

const past = [];
const future = [];

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(detail = {}) {
  for (const fn of listeners) fn(state, detail);
  scheduleSave();
}

/* ── history ───────────────────────────────────────────────── */

const snapshot = () => ({
  cols: state.cols,
  rows: state.rows,
  cells: structuredClone(state.cells),
});

/** Record the document as it stands *before* a mutation. */
export function commit() {
  past.push(snapshot());
  if (past.length > HISTORY_LIMIT) past.shift();
  future.length = 0;
}

function restore(snap) {
  state.cols = snap.cols;
  state.rows = snap.rows;
  state.cells = snap.cells;
  clampCursor();
}

export function undo() {
  if (!past.length) return false;
  future.push(snapshot());
  restore(past.pop());
  emit({ history: true });
  return true;
}

export function redo() {
  if (!future.length) return false;
  past.push(snapshot());
  restore(future.pop());
  emit({ history: true });
  return true;
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

/* ── cell operations ───────────────────────────────────────── */

export function inBounds(r, c) {
  return r >= 0 && c >= 0 && r < state.rows && c < state.cols;
}

/**
 * Bounds-checked on purpose. Shrinking the grid hides cells rather than
 * destroying them — pull the slider back out and the letters return — so
 * everything that reads the grid has to agree on where the edge is.
 */
export const getCell = (r, c) => (inBounds(r, c) ? state.cells[key(r, c)] : undefined);

export function setCell(r, c, ch) {
  if (!inBounds(r, c)) return;
  const k = key(r, c);
  if (ch == null || ch === "" || ch === " ") delete state.cells[k];
  else state.cells[k] = ch;
}

export function clearCell(r, c) {
  delete state.cells[key(r, c)];
}

/** Bounding box of every visible filled cell, or null when the grid is empty. */
export function contentBounds() {
  let r0 = Infinity, c0 = Infinity, r1 = -Infinity, c1 = -Infinity;
  for (const k of Object.keys(state.cells)) {
    const [r, c] = k.split(":").map(Number);
    if (!inBounds(r, c)) continue;
    if (r < r0) r0 = r;
    if (c < c0) c0 = c;
    if (r > r1) r1 = r;
    if (c > c1) c1 = c;
  }
  return r1 < 0 ? null : { r0, c0, r1, c1 };
}

/** Drop cells that fall outside the current grid. */
export function pruneCells() {
  for (const k of Object.keys(state.cells)) {
    const [r, c] = k.split(":").map(Number);
    if (!inBounds(r, c)) delete state.cells[k];
  }
}

export function translateCells(dr, dc) {
  const next = {};
  for (const [k, v] of Object.entries(state.cells)) {
    const [r, c] = k.split(":").map(Number);
    next[key(r + dr, c + dc)] = v;
  }
  state.cells = next;
}

/* ── cursor & selection ────────────────────────────────────── */

export function clampCursor() {
  ui.cursor.r = Math.min(Math.max(ui.cursor.r, 0), state.rows - 1);
  ui.cursor.c = Math.min(Math.max(ui.cursor.c, 0), state.cols - 1);
  if (ui.selection) {
    const s = ui.selection;
    if (s.r1 >= state.rows || s.c1 >= state.cols) ui.selection = null;
  }
}

export function setCursor(r, c) {
  ui.cursor.r = Math.min(Math.max(r, 0), state.rows - 1);
  ui.cursor.c = Math.min(Math.max(c, 0), state.cols - 1);
}

export function step(n = 1) {
  const { r, c } = ui.cursor;
  if (ui.dir === "across") setCursor(r, c + n);
  else setCursor(r + n, c);
}

export function normaliseSelection(a, b) {
  return {
    r0: Math.min(a.r, b.r),
    c0: Math.min(a.c, b.c),
    r1: Math.max(a.r, b.r),
    c1: Math.max(a.c, b.c),
  };
}

export function* selectedCells() {
  const s = ui.selection;
  if (!s) return;
  for (let r = s.r0; r <= s.r1; r++)
    for (let c = s.c0; c <= s.c1; c++) yield [r, c];
}

/**
 * The run of filled cells through the cursor along the current direction —
 * what a crossword app would highlight as "the word you're in".
 */
export function currentWord() {
  const { r, c } = ui.cursor;
  const dr = ui.dir === "down" ? 1 : 0;
  const dc = ui.dir === "across" ? 1 : 0;
  if (!getCell(r, c)) return { r0: r, c0: c, r1: r, c1: c };

  let a = { r, c };
  while (inBounds(a.r - dr, a.c - dc) && getCell(a.r - dr, a.c - dc)) {
    a = { r: a.r - dr, c: a.c - dc };
  }
  let b = { r, c };
  while (inBounds(b.r + dr, b.c + dc) && getCell(b.r + dr, b.c + dc)) {
    b = { r: b.r + dr, c: b.c + dc };
  }
  return { r0: a.r, c0: a.c, r1: b.r, c1: b.c };
}

/**
 * Standard crossword numbering: a cell is numbered when it begins an
 * across or down run of two or more letters.
 */
export function clueNumbers() {
  const out = new Map();
  let n = 1;
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (!getCell(r, c)) continue;
      const startsAcross = !getCell(r, c - 1) && !!getCell(r, c + 1);
      const startsDown = !getCell(r - 1, c) && !!getCell(r + 1, c);
      if (startsAcross || startsDown) out.set(key(r, c), n++);
    }
  }
  return out;
}

/* ── serialisation ─────────────────────────────────────────── */

export function serialise() {
  return {
    format: "crossword-layout",
    version: 1,
    ...structuredClone(state),
  };
}

export function hydrate(data) {
  if (!data || typeof data !== "object") return false;
  const next = { ...structuredClone(DEFAULTS) };
  for (const k of Object.keys(DEFAULTS)) {
    if (data[k] !== undefined) next[k] = data[k];
  }
  // sanity-check the numeric fields rather than trusting the file
  for (const [k, { min, max }] of Object.entries(LIMITS)) {
    const v = Number(next[k]);
    next[k] = Number.isFinite(v) ? Math.min(Math.max(v, min), max) : DEFAULTS[k];
  }
  if (!next.cells || typeof next.cells !== "object") next.cells = {};
  const cells = {};
  for (const [k, v] of Object.entries(next.cells)) {
    if (!/^\d+:\d+$/.test(k)) continue;
    // files written before letters went monochrome hold { ch, color }
    const ch = typeof v === "string" ? v : v?.ch;
    if (typeof ch === "string" && ch) cells[k] = ch.slice(0, 1);
  }
  next.cells = cells;

  Object.assign(state, next);
  pruneCells();
  clampCursor();
  past.length = 0;
  future.length = 0;
  return true;
}

/* ── persistence ───────────────────────────────────────────── */

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serialise()));
    } catch {
      /* private mode or quota — the tool still works, it just won't remember */
    }
  }, 400);
}

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    return hydrate(JSON.parse(raw));
  } catch {
    return false;
  }
}
