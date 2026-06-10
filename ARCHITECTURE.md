# browser-plan — architecture, tools & storage

Reference for integrating directly against the browser-plan MCP server. For the
overview and setup, see the [README](README.md).

browser-plan is a local **stdio MCP server**. It exposes three tools that
cooperate around a single **session id**: `init_browser_plan_session` mints it,
then every `ask_user` and `save_plan` call carries it so the whole arc — what was
asked, what the user answered, and how the plan evolved — can be replayed later
by the [retrospective viewer](README.md#replay-a-session-browser-plan-retro).

The server writes **nothing** to stdout (reserved for the JSON-RPC stream); all
logs go to stderr.

---

## The `ask_user` tool

| | |
|---|---|
| **Name** | `ask_user` |
| **Title** | Ask the user (browser UI) |
| **Description** | Opens a browser form so the user can answer one or more questions, and returns their answers. |

> **Requires a `sessionId`.** Every `ask_user` call takes the UUID returned by
> `init_browser_plan_session` (in addition to the fields below). The id is used
> only to persist the ask under the session — the browser form never sees it.

### Input schema

```ts
{
  sessionId: string,    // UUID from init_browser_plan_session (required)
  title: string,        // heading at the top of the form (plain text)
  introTitle?: string,  // optional concise title for the intro tab (default "Overview")
  intro?: string,       // optional intro — GitHub-flavored Markdown (see below)
  questions: Question[] // 1..20 items
}
```

### Tabs & navigation

The form is a **tab panel**. If `intro` is provided it becomes the first tab.
Questions are then grouped into tabs by their optional `tab` field (questions
that share a `tab` value land in the same tab; tab order follows first
appearance; untagged questions fall into a single "Questions" tab). When there
is only one tab, the tab strip is hidden.

- **Left / Right arrows** switch tabs (the tab actually changes — automatic
  activation), as does clicking a tab; **Home / End** jump to the first / last.
- **Up / Down arrows** move between a question's options; **Enter / Space**
  select (single) or toggle (multi).
- Text fields and sliders keep their native arrow behavior.
- A footer carries **‹ Back** / **Next ›** and, on the final tab, **Submit**
  (enabled once every `required` question is answered). Tabs that still contain
  an unanswered required question show a small dot.

### Markdown in `intro` and option illustrations

`intro` is rendered as **GitHub-flavored Markdown** in the browser form:
headings, lists, tables, links, blockquotes, **syntax-highlighted code blocks**
(```js, ```python, ```ts, ```tsx via highlight.js), and **diagrams**. Diagrams
can be either **Mermaid** (```mermaid) for flowcharts/sequences/graphs, or a
plain-text/ASCII sketch in a ```text block when a quick hand-drawn layout reads
more clearly — the choice is left to whoever authors the `intro`. The markdown
HTML is sanitized with DOMPurify before rendering. Rendered Mermaid diagrams are
clickable — they open in a large lightbox modal (close with the × button, a
backdrop click, or `Esc`).

The **same renderer** powers per-option illustrations: for `single`/`multi`
questions, an option may be `{ value, markdown }` instead of a plain string. When
any option in a tab has `markdown`, that tab gains a **side panel** that shows
the focused option's illustration, updating live as the user moves between
options. Tabs with no option illustrations stay single-column.

The renderer (`marked`, `mermaid`, `highlight.js`, `dompurify`) is loaded from a
CDN via an import map in `public/index.html`. If the CDN is unreachable, the
markdown gracefully falls back to plain text and the rest of the form still
works. `title` and question `label`s remain plain text.

### Question kinds

| `kind`     | UI control            | Answer value type |
|------------|-----------------------|-------------------|
| `text`     | single-line input     | `string`          |
| `longtext` | multi-line textarea   | `string`          |
| `single`   | radio group           | `string`          |
| `multi`    | checkbox group        | `string[]`        |
| `scale`    | range slider          | `number`          |

```ts
type Option = string | { value: string; markdown?: string };

type Question = { id: string; label: string; required?: boolean; tab?: string } & (
  | { kind: "text";     placeholder?: string }
  | { kind: "longtext"; placeholder?: string }
  | { kind: "single";   options: Option[] }
  | { kind: "multi";    options: Option[] }
  | { kind: "scale";    min: number; max: number; step?: number }
);
```

- `id` is unique within the spec and is the key in the returned answers object.
- `required` is enforced client-side before submit is allowed.
- `tab` (optional) groups the question into a named section/tab. Keep it concise.
- For `single`/`multi`, each option is a plain string **or** `{ value, markdown }`.
  The answer is always the option's `value`; `markdown` (optional) renders in the
  tab's side panel when the option is focused. Option `value`s must be unique
  within a question.

### Return value

Text content holding a JSON string of `{ [questionId]: answerValue }`.

### Other outcomes

- **Unknown `sessionId`** (never created) → a message telling the agent to call
  `init_browser_plan_session` first; no browser opens.
- **Declined / cancelled** elicitation (URL-elicitation path only) →
  `"User cancelled."`
- **No submission within 24 hours** → a timeout message; the process stays
  healthy. (Override the window with the `ASK_ANSWER_TIMEOUT_MS` env var.)

### Environment variables

- `ASK_ANSWER_TIMEOUT_MS` — answer timeout in ms (default `86400000`, i.e. 24h).
- `ASK_NO_OPEN=1` — on the direct-open path, log the URL instead of launching a
  browser (for tests / headless environments).
- `BROWSER_PLAN_DATA_DIR` — override the storage root (default `~/.browser-plan`);
  see [Storage](#storage).

### Example invocation (covers all five kinds, tabs, and an option illustration)

```json
{
  "name": "ask_user",
  "arguments": {
    "title": "Project kickoff preferences",
    "introTitle": "Kickoff",
    "intro": "A few quick questions to set up your workspace.",
    "questions": [
      { "id": "project_name", "kind": "text", "label": "Project name", "placeholder": "e.g. Aurora", "required": true, "tab": "Workspace" },
      { "id": "summary", "kind": "longtext", "label": "One-paragraph summary", "placeholder": "What are we building?", "tab": "Workspace" },
      { "id": "language", "kind": "single", "label": "Primary language", "required": true, "tab": "Workspace",
        "options": [
          { "value": "TypeScript", "markdown": "### TypeScript\n\nFull-stack web with strong typing." },
          "Go", "Rust", "Python"
        ] },
      { "id": "integrations", "kind": "multi", "label": "Integrations to enable", "options": ["GitHub", "Slack", "Linear", "PagerDuty"], "tab": "Integrations" },
      { "id": "priority", "kind": "scale", "label": "Priority (1 = low, 5 = high)", "min": 1, "max": 5, "step": 1, "required": true, "tab": "Priority" }
    ]
  }
}
```

A possible returned result:

```json
{
  "project_name": "Aurora",
  "summary": "A realtime collaboration tool.",
  "language": "TypeScript",
  "integrations": ["GitHub", "Slack"],
  "priority": 4
}
```

---

## The `init_browser_plan_session` tool

| | |
|---|---|
| **Name** | `init_browser_plan_session` |
| **Description** | Mint a session id and create the session on disk. Call this once at the start of a planning arc. |

### Input schema

```ts
{
  title?: string,   // optional short title for the session
  intent?: string,  // optional one-line description of what you're planning
}
```

### Return value

Text content whose first line is `sessionId: <uuid>`, followed by a short note
to pass that id to subsequent `ask_user` / `save_plan` calls. Creating the
session writes `<root>/sessions/<id>/session.json` (see [Storage](#storage)).

---

## The `save_plan` tool

| | |
|---|---|
| **Name** | `save_plan` |
| **Description** | Persist a plan (Markdown) under a session as a new version. History is kept. No browser. |

### Input schema

```ts
{
  sessionId: string,  // UUID from init_browser_plan_session (required)
  plan: string,       // the full plan as a Markdown string (required)
  title?: string,     // optional title for this plan version
}
```

### Return value

Text content:

```
Saved plan v<N> for session <id>
path: <absolute path to plans/v<N>.md>
```

Each call allocates the next version (`v1`, `v2`, …) — earlier versions are kept
on disk so the plan's evolution can be replayed. An unknown `sessionId` returns
a message telling the agent to call `init_browser_plan_session` first.

---

## Storage

browser-plan persists each session under a data root — `$BROWSER_PLAN_DATA_DIR`
if set, otherwise `~/.browser-plan`:

```
~/.browser-plan/
  sessions/
    <sessionId>/
      session.json              # manifest: title?, intent?, timestamps,
                                #   latestPlanVersion, planCount, askCount,
                                #   and asks[]/plans[] index entries
      asks/
        <utcTs>-<askId>.json    # one per ask_user call: the full question
                                #   spec + status (pending|answered|timeout|
                                #   declined|error) + answers/outcome
      plans/
        v1.md   v1.json         # plan markdown + metadata sidecar
        v2.md   v2.json         #   (version, title?, createdAt, file, bytes)
        ...
```

- The **session id is the primary key** tying every ask and plan version
  together, so the bundled retrospective viewer (`browser-plan retro`) can read
  this layout and replay the whole planning arc.
- Set `BROWSER_PLAN_DATA_DIR` to relocate the root (handy for tests — point it at
  a temp dir).
- Persistence is **best-effort**: a disk failure is logged to stderr but never
  blocks an answer or crashes the server.

---

## How the browser opens

You never see a server window — the form just appears. It gets there one of two
ways, chosen automatically per client:

- **URL-mode elicitation** (MCP spec `2025-11-25`, SEP-1036) when the client
  advertises `capabilities.elicitation.url` — e.g. Claude Desktop / claude.ai/code.
- **Direct open** otherwise: since the server runs locally, it opens your default
  browser itself. This covers the **Claude Code CLI**, which advertises a bare
  `elicitation: {}` with no `url` sub-capability.

| Client | advertises `elicitation.url`? | How the browser opens |
|--------|-------------------------------|------------------------|
| Claude Code CLI | No (bare `elicitation: {}`) | Server opens it directly |
| Claude Desktop / claude.ai/code | Yes | Via URL-mode elicitation |

Either way your answers do **not** flow back through the agent — they're
submitted straight to a local HTTP callback on an ephemeral `127.0.0.1` port that
the server runs.

---

## How it works

1. On the first `ask_user` call, a lazy `express` callback server binds an
   ephemeral port on `127.0.0.1` (port `0` → OS-assigned). One instance per
   process, reused thereafter.
2. The tool generates a `sid`, stores the question spec under it, registers a
   pending resolver, and builds `http://127.0.0.1:<port>/ask?sid=<sid>`.
3. It opens that URL in the browser:
   - if the client advertises `elicitation.url`, via a **URL-mode elicitation**
     (the client opens it and the server later sends
     `notifications/elicitation/complete`);
   - otherwise the server opens the default browser directly.
4. The browser page fetches `GET /spec?sid=...`, renders the questions, enforces
   `required`, and on submit `POST`s `{ sid, answers }` to `/submit`.
5. `/submit` resolves the pending promise and the tool returns the answers as
   JSON. The answer timeout (24h by default) guards against no submission.

---

## Security notes

- Callback server binds `127.0.0.1` only, on an ephemeral port.
- No auth beyond the unguessable `sid` (session maps are in-memory only).
- The UI sets no cookies and stores no answers locally — the only thing it keeps
  in `localStorage` is a non-sensitive theme/palette preference. It is built with
  React + htm + Tailwind, loaded as native ES modules from a CDN (esm.sh) via the
  import map in `index.html` — same mechanism as the Markdown/diagram renderer, and
  still with no bundler or build step. Answers are POSTed only to the local
  callback server.
- stdout is never written to — a single stray write would corrupt the JSON-RPC
  stream.
- **Non-sensitive input only:** never collect passwords, API keys, tokens, or
  payment data through the form.
