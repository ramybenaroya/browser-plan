// The React form. Authored with htm (JSX-like tagged templates) so it runs as a
// native ES module with no build step. Styling is Tailwind utilities (the v4
// browser build observes the DOM); the tab strip / illustration layout and the
// markdown/diagram/loading visuals that Tailwind can't reach live in styles.css.
//
// Layout is a tab panel: an optional intro markdown tab, then one tab per author
// `tab` group of questions. Left/Right arrows switch tabs (and activate them);
// Up/Down move between a question's options. When a tab has options carrying
// `markdown`, a side panel renders the focused option's illustration.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { html } from "htm/react";
import { Markdown, DiagramModal } from "./intro.js";
import { defaultValueFor, isAnswered, allRequiredAnswered } from "./validation.js";

// Shared class strings, kept out of the markup for readability.
const FIELD = "flex flex-col gap-2.5 min-w-0";
const FIELDSET = "flex flex-col gap-2.5 border-0 m-0 p-0 min-w-0";
const LABEL = "text-[0.98rem] font-[560] text-fg p-0";
const TEXT_CTL =
  "w-full bg-surface border border-line-strong rounded-ctl text-fg [font:inherit] " +
  "py-3 px-3.5 transition duration-150 placeholder:text-dim focus:outline-none " +
  "focus:border-accent focus:ring-[3px] focus:ring-accent-soft";

function LabelText({ q }) {
  return html`<span
    >${q.label}${q.required
      ? html`<span className="text-accent ml-1" aria-hidden="true">*</span>`
      : null}</span
  >`;
}

function TextField({ q, fieldId, value, onChange, multiline, readOnly }) {
  if (readOnly) {
    const v = typeof value === "string" ? value : "";
    const cls =
      "w-full bg-surface border border-line-strong rounded-ctl text-fg py-3 px-3.5 whitespace-pre-wrap" +
      (multiline ? " min-h-[110px]" : "") +
      (v ? "" : " text-dim italic");
    return html`
      <div className=${FIELD}>
        <label className=${LABEL} htmlFor=${fieldId}><${LabelText} q=${q} /></label>
        <div id=${fieldId} className=${cls}>${v ? v : "(no answer)"}</div>
      </div>
    `;
  }
  const onInput = (e) => onChange(q.id, e.target.value);
  const control = multiline
    ? html`<textarea
        id=${fieldId}
        className=${TEXT_CTL + " resize-y min-h-[110px]"}
        placeholder=${q.placeholder || ""}
        aria-required=${q.required ? "true" : "false"}
        value=${value ?? ""}
        onChange=${onInput}
      ></textarea>`
    : html`<input
        type="text"
        id=${fieldId}
        className=${TEXT_CTL}
        placeholder=${q.placeholder || ""}
        aria-required=${q.required ? "true" : "false"}
        value=${value ?? ""}
        onChange=${onInput}
      />`;
  return html`
    <div className=${FIELD}>
      <label className=${LABEL} htmlFor=${fieldId}><${LabelText} q=${q} /></label>
      ${control}
    </div>
  `;
}

// Re-derive the stored array from the option order so it matches the spec order.
function toggle(q, value, optValue) {
  const set = new Set(value);
  if (set.has(optValue)) set.delete(optValue);
  else set.add(optValue);
  return q.options.map((o) => o.value).filter((v) => set.has(v));
}

// A single- or multi-select question. Options are custom radio/checkbox elements
// (not native inputs) so we can own the arrow keys: Up/Down move within the
// question, Left/Right switch tabs, Enter/Space select. Focusing an option lifts
// its `markdown` to the illustration panel via onPreview.
function ChoiceField({ q, value, onChange, multi, onSwitchTab, onPreview, readOnly }) {
  const refs = useRef([]);
  const initialFocus = useMemo(() => {
    const i = q.options.findIndex((o) =>
      multi ? (value || []).includes(o.value) : value === o.value,
    );
    return i >= 0 ? i : 0;
  }, []); // first render only
  const [focus, setFocus] = useState(initialFocus);

  const preview = (j) => onPreview?.(q.options[j]?.markdown ?? null);

  const select = (j) => {
    const opt = q.options[j];
    onChange(q.id, multi ? toggle(q, value, opt.value) : opt.value);
    preview(j);
  };

  const moveTo = (j) => {
    setFocus(j);
    refs.current[j]?.focus();
    preview(j);
    if (!multi) onChange(q.id, q.options[j].value); // radio convention: arrow selects
  };

  const onKeyDown = (e) => {
    const n = q.options.length;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveTo((focus + 1) % n);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveTo((focus - 1 + n) % n);
        break;
      case "ArrowRight":
        e.preventDefault();
        onSwitchTab?.(1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        onSwitchTab?.(-1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        select(focus);
        break;
      default:
        break;
    }
  };

  return html`
    <fieldset className=${FIELDSET}>
      <legend className=${LABEL}><${LabelText} q=${q} /></legend>
      <div
        role=${multi ? "group" : "radiogroup"}
        aria-label=${q.label}
        className="flex flex-col gap-2"
        onKeyDown=${readOnly ? undefined : onKeyDown}
      >
        ${q.options.map((opt, j) => {
          const checked = multi ? (value || []).includes(opt.value) : value === opt.value;
          // Keep exactly one bg-* utility so Tailwind's ordering can't override the
          // checked tint with the base surface color.
          const cls =
            "flex items-center gap-3 py-3 px-3.5 border rounded-ctl select-none transition duration-150 " +
            (readOnly
              ? ""
              : "cursor-pointer outline-none focus-visible:border-accent " +
                "focus-visible:ring-[3px] focus-visible:ring-accent-soft ") +
            (checked
              ? "border-accent bg-accent-soft"
              : readOnly
                ? "bg-surface border-line-strong opacity-60"
                : "bg-surface border-line-strong hover:border-accent");
          const box = multi
            ? "w-[18px] h-[18px] flex-none rounded-[5px] border-2 grid place-items-center transition " +
              (checked ? "border-accent bg-accent text-white" : "border-line-strong")
            : "w-[18px] h-[18px] flex-none rounded-full border-2 grid place-items-center transition " +
              (checked ? "border-accent" : "border-line-strong");
          return html`
            <div
              key=${opt.value}
              ref=${(el) => (refs.current[j] = el)}
              role=${multi ? "checkbox" : "radio"}
              aria-checked=${checked ? "true" : "false"}
              tabIndex=${readOnly ? -1 : j === focus ? 0 : -1}
              className=${cls}
              onClick=${readOnly
                ? undefined
                : () => {
                    setFocus(j);
                    select(j);
                  }}
              onFocus=${readOnly
                ? undefined
                : () => {
                    setFocus(j);
                    preview(j);
                  }}
              onMouseEnter=${() => preview(j)}
            >
              <span aria-hidden="true" className=${box}>
                ${checked
                  ? multi
                    ? html`<span className="text-[11px] leading-none">✓</span>`
                    : html`<span className="w-2.5 h-2.5 rounded-full bg-accent"></span>`
                  : null}
              </span>
              <span className="flex-1">${opt.value}</span>
            </div>
          `;
        })}
      </div>
    </fieldset>
  `;
}

function ScaleField({ q, fieldId, value, onChange, readOnly }) {
  const step = q.step && q.step > 0 ? q.step : 1;
  const current = value ?? q.min;
  return html`
    <div className=${FIELD}>
      <label className=${LABEL} htmlFor=${fieldId}><${LabelText} q=${q} /></label>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3.5">
          <input
            id=${fieldId}
            type="range"
            min=${q.min}
            max=${q.max}
            step=${step}
            value=${current}
            disabled=${readOnly}
            className="flex-1 [accent-color:var(--accent)] h-1"
            onChange=${(e) => onChange(q.id, Number(e.target.value))}
          />
          <span
            className="flex-none min-w-[3ch] text-center tabular-nums font-[650] text-[1.05rem] text-accent bg-accent-soft rounded-lg py-1 px-2.5"
            >${current}</span
          >
        </div>
        <div className="flex justify-between text-dim text-[0.82rem]">
          <span>${q.min}</span><span>${q.max}</span>
        </div>
      </div>
    </div>
  `;
}

function QuestionField({ q, index, value, onChange, onSwitchTab, onPreview, readOnly }) {
  const fieldId = `field-${index}`;
  switch (q.kind) {
    case "text":
      return html`<${TextField} q=${q} fieldId=${fieldId} value=${value} onChange=${onChange} multiline=${false} readOnly=${readOnly} />`;
    case "longtext":
      return html`<${TextField} q=${q} fieldId=${fieldId} value=${value} onChange=${onChange} multiline=${true} readOnly=${readOnly} />`;
    case "single":
      return html`<${ChoiceField} q=${q} value=${value} onChange=${onChange} multi=${false} onSwitchTab=${onSwitchTab} onPreview=${onPreview} readOnly=${readOnly} />`;
    case "multi":
      return html`<${ChoiceField} q=${q} value=${value} onChange=${onChange} multi=${true} onSwitchTab=${onSwitchTab} onPreview=${onPreview} readOnly=${readOnly} />`;
    case "scale":
      return html`<${ScaleField} q=${q} fieldId=${fieldId} value=${value} onChange=${onChange} readOnly=${readOnly} />`;
    default:
      return html`<div className="text-danger text-[0.9rem] m-0 text-center">
        Unsupported question kind: ${q.kind}
      </div>`;
  }
}

function Title({ text }) {
  return html`<h1
    className="m-0 mb-[18px] text-[clamp(1.45rem,2.2vw,1.9rem)] font-[650] tracking-[-0.01em]"
  >
    ${text}
  </h1>`;
}

// Horizontal tablist. Roving tabindex + automatic activation: Left/Right move to
// (and activate) the adjacent tab; Home/End jump to the ends.
function TabStrip({ tabs, active, onSelect, incomplete }) {
  const refs = useRef([]);
  const onKeyDown = (e) => {
    let next = null;
    if (e.key === "ArrowRight") next = Math.min(active + 1, tabs.length - 1);
    else if (e.key === "ArrowLeft") next = Math.max(active - 1, 0);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    onSelect(next);
    refs.current[next]?.focus();
  };
  return html`
    <div role="tablist" aria-label="Sections" className="tabs" onKeyDown=${onKeyDown}>
      ${tabs.map((t, i) => {
        const selected = i === active;
        return html`
          <button
            key=${t.id}
            ref=${(el) => (refs.current[i] = el)}
            role="tab"
            type="button"
            id=${`tab-${t.id}`}
            aria-selected=${selected ? "true" : "false"}
            aria-controls=${`panel-${t.id}`}
            tabIndex=${selected ? 0 : -1}
            className=${"tab" + (selected ? " tab--active" : "")}
            onClick=${() => onSelect(i)}
          >
            <span>${t.title}</span>
            ${incomplete[i]
              ? html`<span
                  className="tab__dot"
                  title="Has unanswered required questions"
                  aria-label="incomplete"
                ></span>`
              : null}
          </button>
        `;
      })}
    </div>
  `;
}

function IllustrationPanel({ markdown, onOpenDiagram }) {
  return html`
    <aside className="illus" aria-label="Option details">
      <div className="illus__inner">
        ${markdown
          ? html`<${Markdown} key=${markdown} markdown=${markdown} onOpenDiagram=${onOpenDiagram} />`
          : html`<p className="illus__empty">Focus an option to see details.</p>`}
      </div>
    </aside>
  `;
}

function TabPanel({ tab, answers, onChange, onOpenDiagram, onSwitchTab, preview, onPreview, readOnly }) {
  const panelId = `panel-${tab.id}`;
  const labelledBy = `tab-${tab.id}`;

  if (tab.kind === "intro") {
    return html`
      <div
        role="tabpanel"
        id=${panelId}
        aria-labelledby=${labelledBy}
        className="tabpanel"
        tabIndex=${0}
      >
        <${Markdown} markdown=${tab.markdown} onOpenDiagram=${onOpenDiagram} />
      </div>
    `;
  }

  const fields = html`
    <form className="flex flex-col gap-[22px] min-w-0" onSubmit=${(e) => e.preventDefault()}>
      ${tab.questions.map(
        (q, i) =>
          html`<${QuestionField}
            key=${q.id}
            q=${q}
            index=${i}
            value=${answers[q.id]}
            onChange=${onChange}
            onSwitchTab=${onSwitchTab}
            onPreview=${onPreview}
            readOnly=${readOnly}
          />`,
      )}
    </form>
  `;

  if (!tabHasIllustrations(tab)) {
    return html`
      <div role="tabpanel" id=${panelId} aria-labelledby=${labelledBy} className="tabpanel">
        ${fields}
      </div>
    `;
  }

  return html`
    <div
      role="tabpanel"
      id=${panelId}
      aria-labelledby=${labelledBy}
      className="tabpanel tabpanel--split"
    >
      ${fields}
      <${IllustrationPanel} markdown=${preview} onOpenDiagram=${onOpenDiagram} />
    </div>
  `;
}

function Footer({ activeTab, isLast, valid, submitting, onBack, onNext, onSubmit, error }) {
  const btn =
    "appearance-none rounded-ctl [font:inherit] font-semibold py-[11px] px-[18px] cursor-pointer " +
    "transition duration-150 disabled:opacity-[0.45] disabled:cursor-not-allowed";
  const ghost = btn + " border border-line-strong bg-surface text-fg enabled:hover:border-accent";
  const primary =
    btn + " border-0 bg-accent text-white enabled:hover:bg-accent-hover enabled:active:translate-y-px";
  return html`
    <div className="mt-[26px] flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <button type="button" className=${ghost} disabled=${activeTab === 0} onClick=${onBack}>
          ‹ Back
        </button>
        ${isLast
          ? html`<button
              type="button"
              className=${primary}
              disabled=${!valid || submitting}
              onClick=${onSubmit}
            >
              ${submitting ? "Submitting…" : "Submit"}
            </button>`
          : html`<button type="button" className=${primary} onClick=${onNext}>Next ›</button>`}
      </div>
      <p className="text-center text-dim text-[0.85rem] m-0">
        Your answers are sent only to your local machine.
      </p>
      ${error
        ? html`<p id="submit-error" className="text-danger text-[0.9rem] m-0 text-center">${error}</p>`
        : null}
    </div>
  `;
}

function StateMessage({ kind, title, body }) {
  return html`
    <div className=${`state ${kind}`}>
      ${kind === "loading" ? html`<div className="spinner" aria-hidden="true"></div>` : null}
      ${kind === "done" ? html`<div className="check" aria-hidden="true">✓</div>` : null}
      ${title ? html`<h2>${title}</h2>` : null}
      ${body ? html`<p>${body}</p>` : null}
    </div>
  `;
}

// --- Tab model helpers ------------------------------------------------------

// Turn a spec into an ordered tab list: an optional intro tab, then one tab per
// `tab` group (order = first appearance; untagged questions fall into "Questions").
function buildTabs(spec) {
  const tabs = [];
  if (spec.intro) {
    tabs.push({
      id: "intro",
      kind: "intro",
      title: spec.introTitle || "Overview",
      markdown: spec.intro,
    });
  }
  const order = [];
  const groups = new Map();
  for (const q of spec.questions) {
    const key = q.tab || "";
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push(q);
  }
  order.forEach((key, gi) => {
    tabs.push({
      id: `sec${gi}`,
      kind: "questions",
      title: key || "Questions",
      questions: groups.get(key),
    });
  });
  return tabs;
}

const isChoice = (q) => q.kind === "single" || q.kind === "multi";

function tabHasIllustrations(tab) {
  return (
    tab.kind === "questions" &&
    tab.questions.some((q) => isChoice(q) && q.options.some((o) => o.markdown))
  );
}

function tabIncomplete(tab, answers) {
  return (
    tab.kind === "questions" &&
    tab.questions.some((q) => q.required && !isAnswered(q, answers[q.id]))
  );
}

// The markdown to seed the side panel with when a tab opens: a selected option's
// illustration if there is one, else the first option carrying markdown, else null.
function initialPreview(tab, answers) {
  if (tab.kind !== "questions") return null;
  for (const q of tab.questions) {
    if (!isChoice(q)) continue;
    const v = answers[q.id];
    const selected = q.options.find((o) =>
      q.kind === "multi" ? (v || []).includes(o.value) : v === o.value,
    );
    if (selected?.markdown) return selected.markdown;
  }
  for (const q of tab.questions) {
    if (!isChoice(q)) continue;
    const withMd = q.options.find((o) => o.markdown);
    if (withMd) return withMd.markdown;
  }
  return null;
}

export function App() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const sid = useMemo(() => params.get("sid"), [params]);
  // Embed (read-only) mode: the plans-retro viewer renders the form in an iframe to
  // show a stored questionnaire. `src` is a same-origin relative path the form
  // fetches instead of /spec?sid= — its payload carries `answers` (and status).
  const embed = useMemo(() => params.has("embed"), [params]);
  // Demo (showcase) mode: the gh-pages site renders the form statically, with no
  // callback server behind it. Submit resolves straight to the "done" state
  // instead of POSTing to /submit (which wouldn't exist on a static host).
  const demo = useMemo(() => params.has("demo"), [params]);
  const specSrc = useMemo(() => {
    const s = params.get("src");
    return s && s.startsWith("/") ? s : null;
  }, [params]);
  const readOnly = embed;
  const [phase, setPhase] = useState("loading"); // loading | form | error | done
  const [spec, setSpec] = useState(null);
  const [error, setError] = useState(null); // { title, body }
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [zoomedSvg, setZoomedSvg] = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  const [preview, setPreview] = useState(null);

  const onOpenDiagram = useCallback((svg) => setZoomedSvg(svg), []);
  const closeDiagram = useCallback(() => setZoomedSvg(null), []);
  const setAnswer = useCallback(
    (id, value) => setAnswers((prev) => ({ ...prev, [id]: value })),
    [],
  );

  // Boot: fetch the spec, seed the answers. The live form reads /spec?sid=; the
  // embed reads `src` and seeds from the stored answers it carries.
  useEffect(() => {
    const url = specSrc ?? (sid ? `/spec?sid=${encodeURIComponent(sid)}` : null);
    if (!url) {
      setError({ title: "Missing session", body: "No session id was provided in the URL." });
      setPhase("error");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (cancelled) return;
        const stored = data.answers || {};
        const seeded = {};
        for (const q of data.questions)
          seeded[q.id] = stored[q.id] !== undefined ? stored[q.id] : defaultValueFor(q);
        setAnswers(seeded);
        setSpec(data);
        setPhase("form");
      } catch (e) {
        if (cancelled) return;
        setError({
          title: "Session unavailable",
          body: "This question session is no longer available. You can return to Claude Code.",
        });
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sid, specSrc]);

  // In embed mode, report our content height to the parent so it can size the
  // iframe (no inner scrollbar). Fires on mount and whenever the layout changes.
  useEffect(() => {
    if (!embed) return;
    const post = () =>
      window.parent.postMessage(
        { type: "browser-plan:embed-height", height: document.documentElement.scrollHeight },
        "*",
      );
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [embed]);

  const submit = useCallback(async () => {
    if (demo) {
      setPhase("done");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch("/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid, answers }),
      });
      if (!res.ok) throw new Error(`submit failed (${res.status})`);
      setPhase("done");
    } catch (e) {
      setSubmitting(false);
      setSubmitError("Could not submit your answers. Please try again.");
    }
  }, [sid, answers, demo]);

  const tabs = useMemo(() => (spec ? buildTabs(spec) : []), [spec]);

  // Switch tab by delta and move keyboard focus to the new tab button, so the
  // arrow-from-options handoff lands on the tablist (WAI-ARIA automatic activation).
  const onSwitchTab = useCallback(
    (dir) => {
      setActiveTab((cur) => {
        const next = Math.min(Math.max(cur + dir, 0), tabs.length - 1);
        if (next !== cur) {
          const id = `tab-${tabs[next].id}`;
          requestAnimationFrame(() => document.getElementById(id)?.focus());
        }
        return next;
      });
    },
    [tabs],
  );

  // Seed the side panel when the active tab changes (read latest answers via a
  // ref so answering a question doesn't reset the focused-option preview).
  const answersRef = useRef(answers);
  answersRef.current = answers;
  useEffect(() => {
    if (tabs.length) setPreview(initialPreview(tabs[activeTab], answersRef.current));
  }, [activeTab, tabs]);

  // Widen the card for the whole session when any tab needs the illustration
  // panel, so switching tabs never jumps the card width.
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    root.classList.toggle("card--wide", tabs.some(tabHasIllustrations));
    return () => root.classList.remove("card--wide");
  }, [tabs]);

  if (phase === "loading") return html`<${StateMessage} kind="loading" body="Loading your question…" />`;
  if (phase === "error")
    return html`<${StateMessage} kind="error" title=${error?.title} body=${error?.body} />`;
  if (phase === "done")
    return html`<${StateMessage}
      kind="done"
      title="Answer received"
      body="You can return to Claude Code."
    />`;

  const active = Math.min(activeTab, tabs.length - 1);
  const tab = tabs[active];
  const valid = allRequiredAnswered(spec.questions, answers);
  const showStrip = tabs.length > 1;
  const isLast = active === tabs.length - 1;
  const incomplete = tabs.map((t) => tabIncomplete(t, answers));

  return html`
    <${Fragment}>
      ${readOnly ? null : html`<${Title} text=${spec.title} />`}
      ${showStrip
        ? html`<${TabStrip}
            tabs=${tabs}
            active=${active}
            onSelect=${setActiveTab}
            incomplete=${incomplete}
          />`
        : null}
      <${TabPanel}
        tab=${tab}
        answers=${answers}
        onChange=${setAnswer}
        onOpenDiagram=${onOpenDiagram}
        onSwitchTab=${onSwitchTab}
        preview=${preview}
        onPreview=${setPreview}
        readOnly=${readOnly}
      />
      ${readOnly
        ? null
        : html`<${Footer}
            activeTab=${active}
            isLast=${isLast}
            valid=${valid}
            submitting=${submitting}
            onBack=${() => onSwitchTab(-1)}
            onNext=${() => onSwitchTab(1)}
            onSubmit=${submit}
            error=${submitError}
          />`}
      <${DiagramModal} svg=${zoomedSvg} onClose=${closeDiagram} />
    <//>
  `;
}
