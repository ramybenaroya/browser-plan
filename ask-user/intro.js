// The async markdown intro and the diagram lightbox. Both deal with imperative
// DOM (sanitized HTML, mermaid SVG) that React must not own, so they use refs +
// effects rather than rendered children.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { html } from "htm/react";
import { loadMarkdownLibs, renderMarkdownInto } from "./markdown.js";
import { getEffectiveMode } from "./theme.js";

/**
 * Renders agent-authored Markdown. The container is rendered empty so the form
 * is interactive immediately; the markdown fills in asynchronously and never
 * blocks submit. Falls back to plain text if the CDN libraries don't load.
 * Used for both the intro tab and the per-option illustration panel, so it
 * accepts an optional `className` for layout while keeping the `markdown` class
 * that styles.css targets.
 */
export function Markdown({ markdown, onOpenDiagram, className = "" }) {
  const ref = useRef(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let cancelled = false;
    const isCancelled = () => cancelled || !container.isConnected;

    const render = async () => {
      const libs = await loadMarkdownLibs();
      if (isCancelled()) return;
      if (!libs) {
        container.textContent = markdown ?? ""; // graceful fallback
        return;
      }
      await renderMarkdownInto(container, markdown ?? "", libs, { onOpenDiagram, isCancelled });
    };

    render();

    // Mermaid bakes light/dark colors into each diagram at render time, so re-run
    // the pipeline when the effective mode flips (manual toggle or OS change in
    // system mode). Palette-only changes don't affect Mermaid, so track the
    // effective mode and skip no-op re-renders.
    let lastEffective = getEffectiveMode();
    const onThemeChange = (e) => {
      const next = e.detail?.effective ?? getEffectiveMode();
      if (next === lastEffective) return;
      lastEffective = next;
      render();
    };
    document.addEventListener("themechange", onThemeChange);

    return () => {
      cancelled = true;
      document.removeEventListener("themechange", onThemeChange);
    };
  }, [markdown, onOpenDiagram]);

  return html`<div className=${`markdown ${className}`.trim()} ref=${ref}></div>`;
}

/**
 * Lightbox for a rendered mermaid diagram. `svg` is the diagram's outerHTML (or
 * null when closed). Rendered through a portal into <body> so the fixed overlay
 * escapes the card's stacking context.
 */
export function DiagramModal({ svg, onClose }) {
  const contentRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!svg) return;

    // Inject the SVG and strip mermaid's intrinsic-size caps so CSS can scale it
    // up to fill the modal. The width/height attributes and inline max-width keep
    // the diagram at its small natural size otherwise; CSS sizes it from here.
    const content = contentRef.current;
    if (content) {
      content.innerHTML = svg;
      const el = content.querySelector("svg");
      if (el) {
        el.removeAttribute("width");
        el.removeAttribute("height");
        el.style.maxWidth = "none";
      }
    }

    const lastFocused = document.activeElement;
    closeRef.current?.focus();
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    };
  }, [svg, onClose]);

  if (!svg) return null;

  return createPortal(
    html`
      <div
        className="diagram-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Diagram"
        onClick=${(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="diagram-modal__content" ref=${contentRef}></div>
        <button
          className="diagram-modal__close"
          type="button"
          aria-label="Close"
          ref=${closeRef}
          onClick=${onClose}
        >
          ✕
        </button>
      </div>
    `,
    document.body,
  );
}
