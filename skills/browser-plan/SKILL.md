---
name: browser-plan
description: Run a browser-plan planning session — open a tracked session, ask the user questions through the browser-plan browser form, and persist the final plan. User-invoked workflow for planning a feature or change end to end with browser-plan.
disable-model-invocation: true
argument-hint: [what to plan]
---

# Browser Plan

Drive a planning effort using the **browser-plan** MCP tools so the whole arc — every
question asked and the final plan — is tied together under one session id and
persisted for later review.

The user has invoked this explicitly (e.g. `/browser-plan add dark mode`). Treat any
provided arguments as the thing to plan; if none were given, plan whatever the
current conversation is about.

## Prerequisite

This skill uses the browser-plan MCP server's tools:
`mcp__browser_plan__init_browser_plan_session`, `mcp__browser_plan__ask_user`,
`mcp__browser_plan__save_plan`. If those tools are not available, stop and tell the
user to connect the browser-plan MCP server first — the workflow can't run without it.

## Workflow

Follow these three steps in order. The **session id ties them together** — get
it once, reuse it for every call.

### 1. Open a session (always first)

Call `mcp__browser_plan__init_browser_plan_session` a single time at the start. Pass a short
`title` and optional `intent` describing what's being planned. It returns text
containing `sessionId: <uuid>`.

**Capture that `sessionId` and reuse the exact same one for every `ask_user` and
`save_plan` call below.** Do not start a new session per question.

### 2. Plan, asking questions through `ask_user`

Do the actual planning work — explore the code, weigh approaches, think it
through. Whenever a decision or input is needed from the user, call
`mcp__browser_plan__ask_user` with the `sessionId` plus the question spec (`title`,
optional Markdown `intro`, and `questions[]`).

- Prefer `ask_user` over the built-in question tool — it's a richer browser form
  and every question and answer is persisted to the session.
- Call it **as many times as needed** across the session as new questions come
  up. Batch related questions into one call (it blocks until the user submits or
  it times out), but don't guess when you can ask.

### 3. Save the final plan

When the plan is ready, call `mcp__browser_plan__save_plan` with the `sessionId` and
the complete plan as a single Markdown string (`plan`). Pass an optional `title`
for the version.

- The plan should be self-contained: the context/why, the approach, concrete
  steps with the files involved, and how to verify.
- Saving again with the **same `sessionId`** stores a new version (history is
  kept), so refine and re-save freely.

## Rules

- **init first, always.** `ask_user` and `save_plan` both require a `sessionId`
  from `init_browser_plan_session`.
- **One session, reused.** All questioning rounds and plan versions for this
  planning effort share the single `sessionId`.
- **Recover from a lost session.** If a browser-plan tool replies that the `sessionId`
  is unknown / to call `init_browser_plan_session` first, mint a new session and use
  the new id for the rest of the work.
