/* ============================================================
   controls.js — the sidebar.

   Every numeric setting is a slider and a number field bound to the
   same value, so you can scrub for feel or type an exact figure.
   ============================================================ */

import { state, ui, LIMITS, PALETTE, commit, selectedCells, pruneCells, clampCursor, contentBounds, translateCells } from "./state.js";

const $ = (id) => document.getElementById(id);

/** Set once by attachControls; every binding repaints through it. */
let repaint = () => {};

/**
 * Ties a range input and a number input to one value.
 * The range paints its own progress fill (WebKit has no native one).
 */
function bindPair(name, { get, set, onInput }) {
  const range = $(`${name}Range`);
  const num = $(`${name}Num`);
  const { min, max } = LIMITS[name] ?? { min: Number(range.min), max: Number(range.max) };

  range.min = num.min = min;
  range.max = num.max = max;

  const paint = (v) => {
    range.style.setProperty("--fill", `${((v - min) / (max - min)) * 100}%`);
  };

  const sync = () => {
    const v = get();
    if (document.activeElement !== range) range.value = v;
    if (document.activeElement !== num) num.value = v;
    paint(v);
  };

  const apply = (raw, { commitFirst = true } = {}) => {
    let v = Number(raw);
    if (!Number.isFinite(v)) return sync();
    v = Math.min(Math.max(v, min), max);
    if (v === get()) { paint(v); return; }
    set(v, { commitFirst });
    sync();
    onInput?.(v);
    repaint();
  };

  let scrubbing = false;
  range.addEventListener("pointerdown", () => { scrubbing = false; });
  range.addEventListener("input", () => {
    apply(range.value, { commitFirst: !scrubbing });
    scrubbing = true;
  });
  range.addEventListener("change", () => { scrubbing = false; });

  num.addEventListener("input", () => {
    if (num.value === "" || num.value === "-") return;
    apply(num.value);
  });
  num.addEventListener("blur", sync);
  num.addEventListener("keydown", (e) => { if (e.key === "Enter") num.blur(); });

  return { sync };
}

export function attachControls({ draw, fit, onExport, onSave, onLoad, onHelp }) {
  repaint = draw;
  const syncers = [];
  const plain = (k) => ({
    get: () => state[k],
    set: (v) => { state[k] = v; },
  });

  /* ── grid ─────────────────────────────────────────────── */

  /* Resizing hides letters rather than deleting them, so pulling a
     slider back the other way brings the layout straight back. */
  syncers.push(bindPair("cols", {
    get: () => state.cols,
    set: (v) => { state.cols = v; clampCursor(); },
  }).sync);

  syncers.push(bindPair("rows", {
    get: () => state.rows,
    set: (v) => { state.rows = v; clampCursor(); },
  }).sync);

  /* ── cell size, optionally linked ─────────────────────── */

  const linkBtn = $("btnLink");

  const cellW = bindPair("cellW", {
    get: () => state.cellW,
    set: (v) => {
      state.cellW = v;
      if (state.linked) state.cellH = Math.min(Math.max(v, LIMITS.cellH.min), LIMITS.cellH.max);
    },
    onInput: () => { cellH.sync(); },
  });

  const cellH = bindPair("cellH", {
    get: () => state.cellH,
    set: (v) => {
      state.cellH = v;
      if (state.linked) state.cellW = Math.min(Math.max(v, LIMITS.cellW.min), LIMITS.cellW.max);
    },
    onInput: () => { cellW.sync(); },
  });

  syncers.push(cellW.sync, cellH.sync);

  linkBtn.addEventListener("click", () => {
    state.linked = !state.linked;
    linkBtn.classList.toggle("is-on", state.linked);
    linkBtn.setAttribute("aria-pressed", String(state.linked));
    if (state.linked) {
      state.cellH = state.cellW;
      cellH.sync();
      draw();
    }
  });

  /* ── type ─────────────────────────────────────────────── */

  syncers.push(bindPair("fontSize", plain("fontSize")).sync);
  syncers.push(bindPair("baseline", {
    get: () => state.baseline,
    set: (v) => { state.baseline = v; },
  }).sync);

  const chkUpper = $("chkUpper");
  chkUpper.addEventListener("change", () => {
    state.upper = chkUpper.checked;
    if (state.upper) {
      commit();
      for (const cell of Object.values(state.cells)) cell.ch = cell.ch.toUpperCase();
    }
    draw();
  });

  /* ── colour ───────────────────────────────────────────── */

  const swatchWrap = $("swatches");
  const inkCustom = $("inkCustom");
  const bgColor = $("bgColor");
  const chkTransparent = $("chkTransparent");

  function applyInk(colour) {
    state.ink = colour;
    if (ui.selection) {
      commit();
      for (const [r, c] of selectedCells()) {
        const cell = state.cells[`${r}:${c}`];
        if (cell) cell.color = colour;
      }
    }
    paintSwatches();
    draw();
  }

  PALETTE.forEach((colour) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.style.background = colour;
    b.dataset.colour = colour;
    b.title = colour;
    b.setAttribute("aria-label", `Letter colour ${colour}`);
    b.addEventListener("click", () => { inkCustom.value = colour; applyInk(colour); });
    swatchWrap.appendChild(b);
  });

  function paintSwatches() {
    for (const b of swatchWrap.children) {
      b.classList.toggle("is-on", b.dataset.colour.toLowerCase() === state.ink.toLowerCase());
    }
  }

  inkCustom.addEventListener("input", () => applyInk(inkCustom.value));
  bgColor.addEventListener("input", () => { state.bg = bgColor.value; draw(); });

  chkTransparent.addEventListener("change", () => {
    state.transparent = chkTransparent.checked;
    draw();
  });

  /* ── canvas ───────────────────────────────────────────── */

  syncers.push(bindPair("pad", plain("pad")).sync);
  syncers.push(bindPair("zoom", plain("zoom")).sync);

  $("btnFit").addEventListener("click", fit);

  const chkGuides = $("chkGuides");
  chkGuides.addEventListener("change", () => { state.guides = chkGuides.checked; draw(); });

  const chkNumbers = $("chkNumbers");
  chkNumbers.addEventListener("change", () => { state.numbers = chkNumbers.checked; draw(); });

  /* ── actions ──────────────────────────────────────────── */

  $("btnTrim").addEventListener("click", () => {
    const b = contentBounds();
    if (!b) return;
    commit();
    pruneCells();              // anything parked outside the grid goes for good
    translateCells(-b.r0, -b.c0);
    state.rows = Math.max(1, b.r1 - b.r0 + 1);
    state.cols = Math.max(1, b.c1 - b.c0 + 1);
    clampCursor();
    syncAll();
    draw();
  });

  $("btnClear").addEventListener("click", () => {
    if (!Object.keys(state.cells).length) return;
    commit();
    state.cells = {};
    ui.selection = null;
    draw();
  });

  $("btnExport").addEventListener("click", onExport);
  $("btnSave").addEventListener("click", onSave);
  $("btnLoad").addEventListener("click", onLoad);
  $("btnHelp").addEventListener("click", onHelp);

  /* ── keep the panel in step with the model ────────────── */

  function syncAll() {
    for (const sync of syncers) sync();
    linkBtn.classList.toggle("is-on", state.linked);
    linkBtn.setAttribute("aria-pressed", String(state.linked));
    chkUpper.checked = state.upper;
    chkGuides.checked = state.guides;
    chkNumbers.checked = state.numbers;
    chkTransparent.checked = state.transparent;
    inkCustom.value = state.ink;
    bgColor.value = state.bg;
    paintSwatches();
  }

  syncAll();
  return { syncAll };
}
