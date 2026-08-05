/* ============================================================
   input.js — pointer and keyboard behaviour.

   The grid behaves the way a crossword grid should: click to place
   the cursor, click again to flip direction, type and it advances.
   ============================================================ */

import {
  state, ui, LIMITS,
  commit, undo, redo,
  setCell, clearCell, setCursor, step,
  normaliseSelection, selectedCells, inBounds, getCell,
} from "./state.js";
import { geometry, cellAt } from "./render.js";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
const accel = (e) => (isMac ? e.metaKey : e.ctrlKey);

export function attachInput({ board, proxy, draw }) {
  let anchor = null;      // selection anchor while dragging
  let dragging = false;
  let movedDuringDrag = false;
  let keyAnchor = null;   // anchor for shift+arrow selection

  /* ── pointer ──────────────────────────────────────────── */

  const toCell = (ev) => {
    const rect = board.getBoundingClientRect();
    const g = geometry(state);
    const x = ((ev.clientX - rect.left) / rect.width) * g.w;
    const y = ((ev.clientY - rect.top) / rect.height) * g.h;
    const { r, c } = cellAt(state, x, y);
    return {
      r: Math.min(Math.max(r, 0), state.rows - 1),
      c: Math.min(Math.max(c, 0), state.cols - 1),
    };
  };

  board.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    focusProxy();
    const cell = toCell(ev);

    if (ev.shiftKey) {
      ui.selection = normaliseSelection({ r: ui.cursor.r, c: ui.cursor.c }, cell);
      anchor = { r: ui.cursor.r, c: ui.cursor.c };
    } else {
      const same = cell.r === ui.cursor.r && cell.c === ui.cursor.c && !ui.selection;
      if (same) ui.dir = ui.dir === "across" ? "down" : "across";
      setCursor(cell.r, cell.c);
      ui.selection = null;
      anchor = cell;
    }

    keyAnchor = null;
    dragging = true;
    movedDuringDrag = false;
    board.setPointerCapture(ev.pointerId);
    draw();
  });

  board.addEventListener("pointermove", (ev) => {
    if (!dragging || !anchor) return;
    const cell = toCell(ev);
    if (cell.r === anchor.r && cell.c === anchor.c) {
      if (!movedDuringDrag) return;
      ui.selection = null;
      draw();
      return;
    }
    movedDuringDrag = true;
    ui.selection = normaliseSelection(anchor, cell);
    draw();
  });

  const endDrag = (ev) => {
    if (!dragging) return;
    dragging = false;
    if (board.hasPointerCapture?.(ev.pointerId)) board.releasePointerCapture(ev.pointerId);
  };
  board.addEventListener("pointerup", endDrag);
  board.addEventListener("pointercancel", endDrag);

  /* ── keyboard ─────────────────────────────────────────── */

  function focusProxy() {
    if (document.activeElement !== proxy) proxy.focus({ preventScroll: true });
  }

  function typeChar(raw) {
    let ch = state.upper ? raw.toUpperCase() : raw;
    if (ui.selection) {
      setCursor(ui.selection.r0, ui.selection.c0);
      ui.selection = null;
    }
    commit();
    setCell(ui.cursor.r, ui.cursor.c, ch);
    step(1);
    draw();
  }

  function clearSelection() {
    commit();
    for (const [r, c] of selectedCells()) clearCell(r, c);
    draw();
  }

  function move(dr, dc, extend) {
    if (extend) {
      if (!keyAnchor) keyAnchor = { r: ui.cursor.r, c: ui.cursor.c };
      setCursor(ui.cursor.r + dr, ui.cursor.c + dc);
      ui.selection = normaliseSelection(keyAnchor, ui.cursor);
    } else {
      keyAnchor = null;
      ui.selection = null;
      setCursor(ui.cursor.r + dr, ui.cursor.c + dc);
      ui.dir = dr !== 0 ? "down" : "across";
    }
    draw();
  }

  proxy.addEventListener("keydown", (ev) => {
    const k = ev.key;

    if (accel(ev)) {
      const lower = k.toLowerCase();
      if (lower === "z") {
        ev.preventDefault();
        (ev.shiftKey ? redo : undo)();
        return;
      }
      if (lower === "y") { ev.preventDefault(); redo(); return; }
      if (lower === "a") {
        ev.preventDefault();
        ui.selection = { r0: 0, c0: 0, r1: state.rows - 1, c1: state.cols - 1 };
        draw();
        return;
      }
      return; // let copy / paste / reload through
    }

    switch (k) {
      case "ArrowUp":    ev.preventDefault(); return move(-1, 0, ev.shiftKey);
      case "ArrowDown":  ev.preventDefault(); return move(1, 0, ev.shiftKey);
      case "ArrowLeft":  ev.preventDefault(); return move(0, -1, ev.shiftKey);
      case "ArrowRight": ev.preventDefault(); return move(0, 1, ev.shiftKey);

      case "Home":
        ev.preventDefault();
        setCursor(ui.cursor.r, 0); ui.selection = null; return draw();
      case "End":
        ev.preventDefault();
        setCursor(ui.cursor.r, state.cols - 1); ui.selection = null; return draw();

      case "Tab":
      case "Enter":
        ev.preventDefault();
        ui.dir = ui.dir === "across" ? "down" : "across";
        return draw();

      case "Escape":
        ev.preventDefault();
        ui.selection = null; keyAnchor = null;
        return draw();

      case "Backspace": {
        ev.preventDefault();
        if (ui.selection) return clearSelection();
        commit();
        if (getCell(ui.cursor.r, ui.cursor.c)) {
          clearCell(ui.cursor.r, ui.cursor.c);
        } else {
          step(-1);
          clearCell(ui.cursor.r, ui.cursor.c);
        }
        return draw();
      }

      case "Delete": {
        ev.preventDefault();
        if (ui.selection) return clearSelection();
        commit();
        clearCell(ui.cursor.r, ui.cursor.c);
        return draw();
      }

      case " ": {
        ev.preventDefault();
        if (ui.selection) { setCursor(ui.selection.r0, ui.selection.c0); ui.selection = null; }
        commit();
        clearCell(ui.cursor.r, ui.cursor.c);
        step(1);
        return draw();
      }
    }

    /* a printable character — preventDefault also stops the `input`
       event below from firing a second copy of it */
    if (k.length === 1 && !ev.altKey) {
      ev.preventDefault();
      typeChar(k);
    }
  });

  /* Soft keyboards on Android report keydown as "Unidentified"; those
     land here instead, one `input` event per inserted character. */
  proxy.addEventListener("input", () => {
    const value = proxy.value;
    proxy.value = "";
    if (!value) return;
    for (const ch of value) {
      if (ch === "\n" || ch === "\r") ui.dir = ui.dir === "across" ? "down" : "across";
      else typeChar(ch);
    }
  });

  /* ── clipboard ────────────────────────────────────────── */

  function regionAsText() {
    const s = ui.selection ?? { r0: 0, c0: 0, r1: state.rows - 1, c1: state.cols - 1 };
    const lines = [];
    for (let r = s.r0; r <= s.r1; r++) {
      let line = "";
      for (let c = s.c0; c <= s.c1; c++) line += getCell(r, c) ?? " ";
      lines.push(line.replace(/\s+$/, ""));
    }
    return lines.join("\n");
  }

  proxy.addEventListener("copy", (ev) => {
    ev.clipboardData?.setData("text/plain", regionAsText());
    ev.preventDefault();
  });

  proxy.addEventListener("cut", (ev) => {
    ev.clipboardData?.setData("text/plain", regionAsText());
    ev.preventDefault();
    if (ui.selection) clearSelection();
  });

  proxy.addEventListener("paste", (ev) => {
    const text = ev.clipboardData?.getData("text/plain");
    if (!text) return;
    ev.preventDefault();
    pasteText(text);
  });

  function pasteText(text) {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    commit();

    if (lines.length === 1) {
      // a single word runs along the current direction
      for (const ch of lines[0]) {
        if (ch === " ") { step(1); continue; }
        setCell(ui.cursor.r, ui.cursor.c, state.upper ? ch.toUpperCase() : ch);
        step(1);
      }
      draw();
      return;
    }

    // a block of text drops in as a block, growing the grid to fit
    const { r: r0, c: c0 } = ui.cursor;
    const needRows = Math.min(r0 + lines.length, LIMITS.rows.max);
    const needCols = Math.min(c0 + Math.max(...lines.map((l) => l.length)), LIMITS.cols.max);
    state.rows = Math.max(state.rows, needRows);
    state.cols = Math.max(state.cols, needCols);

    lines.forEach((line, i) => {
      [...line].forEach((ch, j) => {
        if (ch === " ") return;
        const r = r0 + i;
        const c = c0 + j;
        if (inBounds(r, c)) setCell(r, c, state.upper ? ch.toUpperCase() : ch);
      });
    });
    draw();
  }

  return { focusProxy, pasteText };
}
