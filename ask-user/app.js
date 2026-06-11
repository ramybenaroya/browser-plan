// Entry point. Loads the Tailwind browser build (it scans/observes the DOM and
// injects the generated CSS), then mounts the React form into #root. All deps
// resolve through the import map in index.html — no bundler, no build step.

import "@tailwindcss/browser";
import { createRoot } from "react-dom/client";
import { html } from "htm/react";
import { App } from "./components.js";
import { mountThemeControls, getStoredTheme, getStoredPalette } from "./theme.js";

// Embed mode (the plans-retro viewer renders the form in a same-origin iframe to show
// a stored questionnaire read-only): hide the header and skip the theme controls.
// The pre-paint inline script in index.html already applied the shared theme/
// palette; we just keep it live when the parent changes it (same-origin storage
// event) — mountThemeControls owns that sync in the standalone app.
const embed = new URLSearchParams(location.search).has("embed");
if (embed) {
  document.body.classList.add("embed");
  window.addEventListener("storage", (e) => {
    if (e.key === "browser-plan-theme" || e.key === "browser-plan-palette") {
      document.documentElement.dataset.theme = getStoredTheme();
      document.documentElement.dataset.palette = getStoredPalette();
    }
  });
} else {
  mountThemeControls(document.getElementById("theme-controls"));
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
