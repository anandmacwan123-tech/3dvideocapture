/* ============================================================
   theme.js — light / dark.

   The board is drawn in SVG, which cannot read CSS variables through
   attributes, so the theme's ink and ground are pulled out of the
   stylesheet once per change and handed to the renderer and the
   exporters. One source of truth, in CSS, for chrome and canvas alike.
   ============================================================ */

const STORAGE_KEY = "layout.theme";

/** Filled from CSS on every theme change. */
export const paint = {
  ink: "#111111",
  ground: "#ffffff",
  guide: "#e8e8e8",
  cursor: "rgba(0,0,0,0.08)",
  word: "rgba(0,0,0,0.035)",
  caret: "#111111",
  number: "#9a9a9a",
};

const VARS = {
  ink: "--board-ink",
  ground: "--board-ground",
  guide: "--board-guide",
  cursor: "--board-cursor",
  word: "--board-word",
  caret: "--board-caret",
  number: "--board-number",
};

let current = "light";
let onChange = () => {};

function readPaint() {
  const style = getComputedStyle(document.documentElement);
  for (const [key, name] of Object.entries(VARS)) {
    const value = style.getPropertyValue(name).trim();
    if (value) paint[key] = value;
  }
}

function apply(theme) {
  current = theme;
  document.documentElement.dataset.theme = theme;

  const btn = document.getElementById("btnTheme");
  if (btn) {
    const dark = theme === "dark";
    btn.setAttribute("aria-pressed", String(dark));
    btn.title = dark ? "Light" : "Dark";
    btn.querySelector(".sr-only").textContent = dark ? "Light" : "Dark";
  }

  readPaint();
  onChange();
}

export const theme = () => current;

export function toggleTheme() {
  const next = current === "dark" ? "light" : "dark";
  apply(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private mode — the choice just won't outlive the session */
  }
}

export function initTheme(handler) {
  onChange = handler;

  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch { /* ignore */ }

  const system = window.matchMedia?.("(prefers-color-scheme: dark)");
  apply(stored ?? (system?.matches ? "dark" : "light"));

  /* follow the system until the user states a preference */
  if (!stored) {
    system?.addEventListener?.("change", (e) => {
      let chosen = null;
      try {
        chosen = localStorage.getItem(STORAGE_KEY);
      } catch { /* ignore */ }
      if (!chosen) apply(e.matches ? "dark" : "light");
    });
  }

  document.getElementById("btnTheme")?.addEventListener("click", toggleTheme);
}
