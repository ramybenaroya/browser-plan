// Markdown/diagram glue, resolved via the import map. Frameworks-free: the only
// React touchpoint is the `onOpenDiagram` callback, which lifts a rendered SVG up
// to component state so the lightbox can be a real React component.

import { getEffectiveMode } from "./theme.js";

/**
 * Lazily import the markdown/diagram libraries (resolved via the import map).
 * Cached after first load. Returns null if the CDN is unreachable so the intro
 * can fall back to plain text without breaking the form.
 */
let markdownLibs;
export async function loadMarkdownLibs() {
  if (markdownLibs !== undefined) return markdownLibs;
  try {
    const [marked, DOMPurify, hljs, mermaid] = await Promise.all([
      import("marked").then((m) => m.marked),
      import("dompurify").then((m) => m.default),
      import("highlight.js").then((m) => m.default),
      import("mermaid").then((m) => m.default),
    ]);
    // js, python and typescript ship in the full highlight.js build; map tsx onto it.
    hljs.registerAliases(["tsx"], { languageName: "typescript" });
    initMermaidTheme(mermaid);
    markdownLibs = { marked, DOMPurify, hljs, mermaid };
  } catch (e) {
    console.error("browser-plan: markdown libraries failed to load", e);
    markdownLibs = null;
  }
  return markdownLibs;
}

// Re-initialize mermaid's theme from the current effective light/dark mode.
// Mermaid bakes colors into each diagram at render time and can't read CSS
// color-scheme, so we resolve the theme here and the caller re-renders on a
// theme flip. Resolve against the chosen theme (light/dark/system), not the OS
// alone, so a manual override themes diagrams correctly.
function initMermaidTheme(mermaid) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: getEffectiveMode() === "dark" ? "dark" : "default",
  });
}

// Monotonic id so re-renders / same-tick diagrams never collide (mermaid throws
// on duplicate DOM ids).
let mermaidSeq = 0;

/**
 * Render `md` (GitHub-flavored Markdown) into `container`, with code highlighting
 * and Mermaid diagrams. `container` is owned imperatively (React renders it empty),
 * so we set innerHTML and post-process freely. Each rendered diagram is clickable
 * and calls `onOpenDiagram(svgMarkup)` to open the React lightbox.
 *
 * `isCancelled()` lets the caller abort between awaits (unmount / StrictMode).
 */
export async function renderMarkdownInto(container, md, libs, { onOpenDiagram, isCancelled } = {}) {
  const { marked, DOMPurify, hljs, mermaid } = libs;

  // Sanitize the rendered markdown before injecting it (intro is agent-authored).
  const html = marked.parse(md, { gfm: true, breaks: true });
  container.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });

  // Syntax-highlight code blocks, leaving mermaid fences for diagram rendering.
  container
    .querySelectorAll("pre code:not(.language-mermaid)")
    .forEach((block) => hljs.highlightElement(block));

  // Replace each ```mermaid block with its rendered SVG. Re-sync the theme first
  // so diagrams match the current light/dark mode even after a theme flip.
  const blocks = container.querySelectorAll("code.language-mermaid");
  if (blocks.length) initMermaidTheme(mermaid);
  for (let i = 0; i < blocks.length; i++) {
    if (isCancelled?.()) return;
    const code = blocks[i];
    const target = code.closest("pre") ?? code;
    try {
      const { svg } = await mermaid.render(`mmd-${mermaidSeq++}`, code.textContent);
      if (isCancelled?.()) return;

      const wrapper = document.createElement("div");
      wrapper.className = "mermaid-diagram zoomable";
      wrapper.setAttribute("role", "button");
      wrapper.setAttribute("tabindex", "0");
      wrapper.setAttribute("aria-label", "Enlarge diagram");
      wrapper.setAttribute("title", "Click to enlarge");
      // svg is produced by mermaid in strict mode (self-sanitized).
      wrapper.innerHTML = svg;

      const badge = document.createElement("span");
      badge.className = "expand-badge";
      badge.setAttribute("aria-hidden", "true");
      badge.textContent = "⤢";
      wrapper.appendChild(badge);

      const open = () => {
        const el = wrapper.querySelector("svg");
        if (el) onOpenDiagram?.(el.outerHTML);
      };
      wrapper.addEventListener("click", open);
      wrapper.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
      target.replaceWith(wrapper);
    } catch (e) {
      console.error("browser-plan: mermaid render failed", e);
      // Leave the original code block in place on error.
    }
  }
}
