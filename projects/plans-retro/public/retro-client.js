// Client bootstrap for plans-retro. Starts the Tailwind browser build (so the
// reused utility classes get generated) and renders every embedded markdown
// block with the exact same pipeline as the form app (marked + DOMPurify +
// highlight.js + mermaid), including click-to-zoom diagrams.
import "@tailwindcss/browser";
import { loadMarkdownLibs, renderMarkdownInto } from "/ui/markdown.js";
import { mountThemeControls, getEffectiveMode } from "/ui/theme.js";

/** Full-screen overlay showing a single diagram; click or Esc to dismiss. */
function openDiagram(svg) {
  const overlay = document.createElement("div");
  overlay.className = "retro-lightbox";
  const inner = document.createElement("div");
  inner.className = "retro-lightbox-inner";
  inner.innerHTML = svg; // svg comes from mermaid in strict mode (self-sanitized)
  // Strip mermaid's intrinsic-size caps so CSS can scale the diagram up to fill
  // the lightbox. The width/height attributes and inline max-width otherwise pin
  // it to its small natural size (matches the form app's DiagramModal).
  const el = inner.querySelector("svg");
  if (el) {
    el.removeAttribute("width");
    el.removeAttribute("height");
    el.style.maxWidth = "none";
  }
  overlay.appendChild(inner);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
}

// Markdown libs, loaded once (null if the CDN was unreachable).
let LIBS;

/** Decode a `<script class="md-src">`'s JSON payload back to the raw markdown. */
function readSource(src) {
  try {
    return JSON.parse(src.textContent || '""');
  } catch {
    return src.textContent || "";
  }
}

/**
 * Render any not-yet-rendered markdown region whose tab panel is currently
 * visible. Each region is a `<script class="md-src">` (JSON string) immediately
 * followed by its `<div class="markdown">`. Blocks inside a hidden tab panel are
 * deferred until their tab is shown — Mermaid needs layout, so rendering into a
 * display:none container would size diagrams to 0. Idempotent via data-rendered.
 */
async function renderPending() {
  const sources = Array.from(document.querySelectorAll("script.md-src"));
  for (const src of sources) {
    const target = src.nextElementSibling;
    if (!(target instanceof HTMLElement) || !target.classList.contains("markdown")) {
      continue;
    }
    if (target.dataset.rendered === "1") continue;
    if (src.closest(".tabpanel[hidden]")) continue; // defer until the tab is shown
    const md = readSource(src);
    if (!LIBS) {
      target.textContent = md; // graceful fallback if the CDN libs failed to load
    } else {
      await renderMarkdownInto(target, md, LIBS, { onOpenDiagram: openDiagram });
    }
    target.dataset.rendered = "1";
  }
}

/** Re-render everything for a theme change (Mermaid bakes colors at render time;
 *  prose + code recolor live via CSS). Visible panels re-render now with the new
 *  Mermaid theme; hidden ones are reset and re-render when their tab is shown. */
function rerenderForTheme() {
  if (LIBS?.mermaid) {
    LIBS.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: getEffectiveMode() === "dark" ? "dark" : "default",
    });
  }
  for (const src of document.querySelectorAll("script.md-src")) {
    const target = src.nextElementSibling;
    if (target instanceof HTMLElement && target.classList.contains("markdown")) {
      target.dataset.rendered = "";
      target.innerHTML = "";
    }
  }
  renderPending();
}

async function main() {
  // Always mount the theme controls (works even if the page has no markdown).
  mountThemeControls(document.getElementById("theme-controls"));

  if (document.querySelectorAll("script.md-src").length === 0) return;

  LIBS = await loadMarkdownLibs();
  await renderPending();
  document.addEventListener("themechange", rerenderForTheme);
}

main();
