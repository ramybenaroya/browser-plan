// Shared theme module for both browser-plan UIs (the React form app and the EJS
// plans-retro viewer). Framework-agnostic plain DOM so both can reuse it: the
// form app imports it from /theme.js, the retro viewer from /ui/theme.js (the
// form app's public/ is served under /ui).
//
// Two independent axes are stored on <html> and persisted to localStorage:
//   - mode    (browser-plan-theme):   light | dark | system   → drives `color-scheme`
//   - palette (browser-plan-palette): indigo | sage | ember    → picks the color family
// styles.css resolves the actual colors from these attributes via light-dark().
// A tiny inline script in each HTML <head> applies the stored values before
// first paint (so there's no flash); this module then mounts the live controls
// and keeps everything in sync.

const THEME_KEY = "browser-plan-theme";
const PALETTE_KEY = "browser-plan-palette";

const MODES = ["light", "dark", "system"];
const PALETTES = [
  { value: "sage", label: "Sage Teal" },
  { value: "indigo", label: "Indigo Twilight" },
  { value: "ember", label: "Warm Ember" },
];
const DEFAULT_MODE = "system";
const DEFAULT_PALETTE = "sage";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

/** Read a persisted value, tolerating disabled/throwing localStorage. */
function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / storage disabled — selection just won't persist */
  }
}

export function getStoredTheme() {
  const v = read(THEME_KEY);
  return MODES.includes(v) ? v : DEFAULT_MODE;
}
export function getStoredPalette() {
  const v = read(PALETTE_KEY);
  return PALETTES.some((p) => p.value === v) ? v : DEFAULT_PALETTE;
}

/** Resolve the effective light/dark mode (system → the OS preference). Used by
 *  the markdown pipeline to theme Mermaid, which can't read CSS color-scheme. */
export function getEffectiveMode() {
  const mode = getStoredTheme();
  if (mode === "light" || mode === "dark") return mode;
  return darkQuery.matches ? "dark" : "light";
}

function notify() {
  document.dispatchEvent(
    new CustomEvent("themechange", {
      detail: { mode: getStoredTheme(), palette: getStoredPalette(), effective: getEffectiveMode() },
    }),
  );
}

export function applyTheme(mode) {
  const next = MODES.includes(mode) ? mode : DEFAULT_MODE;
  document.documentElement.dataset.theme = next;
  write(THEME_KEY, next);
  notify();
}
export function applyPalette(name) {
  const next = PALETTES.some((p) => p.value === name) ? name : DEFAULT_PALETTE;
  document.documentElement.dataset.palette = next;
  write(PALETTE_KEY, next);
  notify();
}

// While in system mode, an OS light/dark flip changes the effective mode even
// though our stored value doesn't — re-broadcast so Mermaid etc. can re-theme.
darkQuery.addEventListener("change", () => {
  if (getStoredTheme() === "system") notify();
});

// Inline SVG glyphs for the segmented toggle (currentColor inherits the button
// color, so they tint with the accent when active).
const ICONS = {
  light: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`,
  dark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  system: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
};
const MODE_LABELS = { light: "Light", dark: "Dark", system: "System" };

// Cog glyph for the settings trigger button.
const COG_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

/**
 * Build the palette dropdown + light/dark/system segmented toggle and inject
 * them into `container` (the .theme-controls slot). Safe to call once per page;
 * a no-op if the container is missing.
 */
export function mountThemeControls(container) {
  if (!container) return;
  container.textContent = "";

  // Cog button that toggles the settings popover.
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "settings-btn";
  trigger.setAttribute("aria-label", "Settings");
  trigger.title = "Settings";
  trigger.innerHTML = COG_ICON;

  // Native popover holding the theme + palette controls (ESC + light-dismiss
  // come for free with the auto popover).
  const pop = document.createElement("div");
  pop.className = "settings-popover";
  pop.id = "browser-plan-settings-popover";
  pop.setAttribute("popover", "");
  trigger.setAttribute("popovertarget", pop.id);

  // Theme row: label + segmented light/dark/system toggle.
  const themeRow = document.createElement("div");
  themeRow.className = "settings-row";
  const themeLabel = document.createElement("span");
  themeLabel.className = "settings-row__label";
  themeLabel.textContent = "Theme";
  themeRow.appendChild(themeLabel);

  const seg = document.createElement("div");
  seg.className = "theme-seg";
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", "Color theme");

  const buttons = MODES.map((mode) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-seg__btn";
    btn.dataset.mode = mode;
    btn.title = MODE_LABELS[mode];
    btn.setAttribute("aria-label", MODE_LABELS[mode]);
    btn.innerHTML = ICONS[mode];
    btn.addEventListener("click", () => {
      applyTheme(mode);
      refresh();
    });
    seg.appendChild(btn);
    return btn;
  });
  themeRow.appendChild(seg);

  // Palette row: label + dropdown.
  const paletteRow = document.createElement("div");
  paletteRow.className = "settings-row";
  const paletteLabel = document.createElement("label");
  paletteLabel.className = "settings-row__label";
  paletteLabel.textContent = "Palette";
  paletteLabel.setAttribute("for", "browser-plan-palette-select");
  paletteRow.appendChild(paletteLabel);

  const select = document.createElement("select");
  select.className = "palette-select";
  select.id = "browser-plan-palette-select";
  for (const p of PALETTES) {
    const opt = document.createElement("option");
    opt.value = p.value;
    opt.textContent = p.label;
    select.appendChild(opt);
  }
  select.value = getStoredPalette();
  select.addEventListener("change", () => applyPalette(select.value));
  paletteRow.appendChild(select);

  pop.append(themeRow, paletteRow);
  container.append(trigger, pop);

  // Anchor the popover under the cog so it reads as a top-right menu rather
  // than the viewport-centered default of the top layer.
  pop.addEventListener("toggle", (e) => {
    if (e.newState !== "open") return;
    const r = trigger.getBoundingClientRect();
    pop.style.top = `${r.bottom + 8}px`;
    pop.style.right = `${window.innerWidth - r.right}px`;
  });

  function refresh() {
    const current = getStoredTheme();
    for (const btn of buttons) {
      btn.setAttribute("aria-pressed", String(btn.dataset.mode === current));
    }
    select.value = getStoredPalette();
  }
  refresh();

  // Keep controls in sync if another tab/app changes the preference, or the
  // OS flips while in system mode.
  document.addEventListener("themechange", refresh);
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_KEY || e.key === PALETTE_KEY) {
      // Re-apply the cross-tab value to our DOM, then refresh the controls.
      document.documentElement.dataset.theme = getStoredTheme();
      document.documentElement.dataset.palette = getStoredPalette();
      refresh();
    }
  });
}
