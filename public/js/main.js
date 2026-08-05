/* ============================================================
   main.js — wiring.
   ============================================================ */

import {
  state, ui, LIMITS,
  subscribe, emit, loadFromStorage, serialise, hydrate, clampCursor,
} from "./state.js";
import { initTheme } from "./theme.js";
import { render, geometry } from "./render.js";
import { attachInput } from "./input.js";
import { attachControls } from "./controls.js";
import { toSVG, toPNGBlob, toText, pngDimensions, download, stamp } from "./exporters.js";

const $ = (id) => document.getElementById(id);

const board = $("board");
const stageScroll = $("stageScroll");
const stageHolder = $("stageHolder");
const proxy = $("keyproxy");

/* ── render scheduling ─────────────────────────────────────── */

let frame = 0;
function draw() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    render(board);
    stageHolder.classList.toggle("is-transparent", state.transparent);
    updateStatus();
    emit();
  });
}

function updateStatus() {
  const g = geometry(state);
  $("statCoord").textContent = ui.selection
    ? `${ui.selection.r1 - ui.selection.r0 + 1} × ${ui.selection.c1 - ui.selection.c0 + 1} selected`
    : `R${ui.cursor.r + 1} · C${ui.cursor.c + 1}`;
  $("statDir").textContent = ui.dir === "across" ? "Across" : "Down";
  $("statSize").textContent = `${g.w} × ${g.h} px`;
}

let flashTimer = 0;
function flash(message) {
  const el = $("statSaved");
  el.textContent = message;
  el.style.opacity = "1";
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.style.opacity = "0"; }, 2200);
}

/* ── zoom to fit ───────────────────────────────────────────── */

function fit() {
  const g = geometry(state);
  const pad = 48;
  const availW = stageScroll.clientWidth - pad;
  const availH = stageScroll.clientHeight - pad;
  const z = Math.min(availW / g.w, availH / g.h) * 100;
  state.zoom = Math.min(Math.max(Math.floor(z), LIMITS.zoom.min), LIMITS.zoom.max);
  controls.syncAll();
  draw();
}

/* ── boot ──────────────────────────────────────────────────── */

/* resolves the board's ink and ground, so it has to run before the first draw */
initTheme(() => draw());

const restored = loadFromStorage();
if (!restored) seed();

const input = attachInput({ board, proxy, draw });

const controls = attachControls({
  draw,
  fit,
  onExport: openExport,
  onSave: saveFile,
  onLoad: () => $("fileInput").click(),
  onHelp: () => $("dlgHelp").showModal(),
});

/* undo / redo mutate the model directly, so re-sync and repaint */
subscribe((_, detail) => {
  if (!detail.history) return;
  controls.syncAll();
  draw();
});

draw();
requestAnimationFrame(() => {
  /* A fresh session gets framed. A restored one keeps the zoom it was left
     at — unless that zoom came from a wider screen and the board no longer
     fits on this one. */
  const tooWide = geometry(state).w * (state.zoom / 100) > stageScroll.clientWidth;
  if (!restored || (tooWide && window.innerWidth <= 734)) fit();
});
proxy.focus({ preventScroll: true });

/* refocus the typing proxy whenever the stage is clicked */
$("stage").addEventListener("pointerdown", (ev) => {
  if (ev.target.closest(".statusbar")) return;
  input.focusProxy();
});

window.addEventListener("resize", () => draw());

/* ── a starting layout, so the tool opens with something in it ── */

function seed() {
  /* every crossing below shares a real letter */
  const OFFSET_R = 4;
  const OFFSET_C = 7;
  const words = [
    { word: "CROSSWORD", r: 0, c: 0, dir: "across" },
    { word: "CAPTURE",   r: 0, c: 0, dir: "down"   },
    { word: "OUTLINE",   r: 0, c: 6, dir: "down"   },
    { word: "DESIGN",    r: 0, c: 8, dir: "down"   },
    { word: "PAGE",      r: 2, c: 0, dir: "across" },
    { word: "UNIT",      r: 4, c: 0, dir: "across" },
    { word: "EDGE",      r: 6, c: 0, dir: "across" },
    { word: "GRID",      r: 2, c: 2, dir: "down"   },
  ];

  for (const { word, r, c, dir } of words) {
    [...word].forEach((ch, i) => {
      const rr = OFFSET_R + (dir === "down" ? r + i : r);
      const cc = OFFSET_C + (dir === "across" ? c + i : c);
      if (rr < state.rows && cc < state.cols) state.cells[`${rr}:${cc}`] = ch;
    });
  }
  ui.cursor = { r: OFFSET_R, c: OFFSET_C };
}

/* ── save / open ───────────────────────────────────────────── */

function saveFile() {
  const blob = new Blob([JSON.stringify(serialise(), null, 2)], { type: "application/json" });
  download(blob, `crossword-${stamp()}.json`);
  flash("Saved");
}

$("fileInput").addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!hydrate(data)) throw new Error("bad file");
    controls.syncAll();
    draw();
    flash(`Opened ${file.name}`);
  } catch {
    flash("That file could not be read");
  }
});

/* ── export dialog ─────────────────────────────────────────── */

const dlg = $("dlgExport");
let format = "svg";

const panels = { svg: $("optSvg"), png: $("optPng"), txt: $("optTxt") };

for (const btn of dlg.querySelectorAll(".seg__btn")) {
  btn.addEventListener("click", () => {
    format = btn.dataset.fmt;
    for (const b of dlg.querySelectorAll(".seg__btn")) b.classList.toggle("is-on", b === btn);
    for (const [k, el] of Object.entries(panels)) el.hidden = k !== format;
  });
}

const scaleRange = $("scaleRange");
const scaleNum = $("scaleNum");

function syncScale(v) {
  const n = Math.min(Math.max(Number(v) || 2, 1), 8);
  scaleRange.value = n;
  scaleNum.value = n;
  scaleRange.style.setProperty("--fill", `${((n - 1) / 7) * 100}%`);
  $("pngDims").textContent = pngDimensions(n);
  return n;
}
scaleRange.addEventListener("input", () => syncScale(scaleRange.value));
scaleNum.addEventListener("input", () => syncScale(scaleNum.value));

function openExport() {
  syncScale(scaleNum.value);
  dlg.showModal();
}

$("btnExportCancel").addEventListener("click", () => dlg.close());
dlg.addEventListener("close", () => input.focusProxy());

async function buildOutput() {
  if (format === "svg") {
    const svg = await toSVG({ outline: $("chkOutline").checked });
    return { text: svg, blob: new Blob([svg], { type: "image/svg+xml" }), name: `crossword-${stamp()}.svg` };
  }
  if (format === "png") {
    const blob = await toPNGBlob(syncScale(scaleNum.value));
    return { blob, name: `crossword-${stamp()}.png` };
  }
  const text = toText();
  return { text, blob: new Blob([text], { type: "text/plain" }), name: `crossword-${stamp()}.txt` };
}

$("btnDownload").addEventListener("click", async () => {
  try {
    const out = await buildOutput();
    download(out.blob, out.name);
    dlg.close();
    flash(`Exported ${out.name}`);
  } catch (err) {
    flash(err.message || "Export failed");
  }
});

$("btnCopy").addEventListener("click", async () => {
  try {
    const out = await buildOutput();
    if (out.text != null) {
      await navigator.clipboard.writeText(out.text);
    } else {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": out.blob })]);
    }
    dlg.close();
    flash("Copied to clipboard");
  } catch {
    flash("Clipboard unavailable — use Download");
  }
});

/* ── help dialog ───────────────────────────────────────────── */

$("btnHelpClose").addEventListener("click", () => $("dlgHelp").close());
$("dlgHelp").addEventListener("close", () => input.focusProxy());

/* ── global shortcuts that work wherever focus sits ────────── */

window.addEventListener("keydown", (ev) => {
  const mod = /Mac|iPhone|iPad/.test(navigator.platform || "") ? ev.metaKey : ev.ctrlKey;
  if (mod && ev.key.toLowerCase() === "s") {
    ev.preventDefault();
    saveFile();
  }
  if (mod && ev.key.toLowerCase() === "e") {
    ev.preventDefault();
    openExport();
  }
});

clampCursor();
