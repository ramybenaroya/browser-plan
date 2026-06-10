// A "heavy" example config as an ES module: the template-literal intro keeps
// the multi-line Markdown (two Mermaid diagrams, two ASCII `text` diagrams, a
// table, three code blocks) readable in a way escaped-JSON can't. Exercises the
// full tab layout — an intro tab plus four `tab` sections — and the per-option
// illustration panel (single + multi options carrying Markdown with Mermaid,
// ASCII art, and code), as well as the diagram-enlarge lightbox on both axes
// (a tall TD chart + a wide LR one). The `text` diagrams show the unbiased
// alternative to Mermaid: a quick hand-drawn layout in a plain code fence.
export default {
  title: "Orders migration — design review",
  introTitle: "Overview",
  intro: `# Migration design review

We're moving the **orders** path off the legacy monolith. Please review the
proposed architecture and weigh in below.

## Why now

> The monolith's deploy time has crept past 40 minutes and a single bad
> migration now blocks every team. Splitting orders out buys us independent
> deploys and a clean data boundary.

See the [tracking issue](https://example.com/issues/1234) for background.

The shape of the change, sketched quickly:

\`\`\`text
        Before  ───────────────▶  After

   ┌────────────────────┐      ┌───────────────────────────┐
   │      Monolith       │      │         API Gateway         │
   │  ┌───────────────┐  │      └───┬───────────┬───────────┬─┘
   │  │ Orders        │  │          │           │           │
   │  │ Inventory     │  │       ┌──▼──┐     ┌──▼──┐     ┌──▼──┐
   │  │ Billing       │  │       │Order│     │ Inv │     │Bill │
   │  └───────────────┘  │       └──┬──┘     └──┬──┘     └──┬──┘
   │    single deploy    │        (DB)        (DB)        (DB)
   └────────────────────┘      independent deploys per team
\`\`\`

## Target architecture

\`\`\`mermaid
flowchart TD
  A[Client] --> B{Authenticated?}
  B -- yes --> C[API Gateway]
  B -- no --> D[Login Service]
  D --> B
  C --> E[Orders Service]
  C --> F[Inventory Service]
  C --> G[Billing Service]
  E --> H[(Orders DB)]
  F --> I[(Inventory DB)]
  G --> J[(Billing DB)]
\`\`\`

## Request pipeline

\`\`\`mermaid
flowchart LR
  A[Ingest] --> B[Parse] --> C[Validate] --> D[Transform] --> E[Enrich] --> F[Aggregate] --> G[Load] --> H[(Warehouse)]
\`\`\`

## Rollout phases

| Phase | Scope                     | Risk   |
| ----- | ------------------------- | ------ |
| 1     | Read path behind a flag   | Low    |
| 2     | Dual-write orders         | Medium |
| 3     | Cut over writes           | High   |
| 4     | Decommission legacy       | Low    |

…and how those phases land over time:

\`\`\`text
  Phase 1      Phase 2        Phase 3         Phase 4
  read path    dual-write     cut over        decommission
  (flag)       both stores    writes          legacy
  ───●──────────●──────────────●───────────────●─────────────▶ time
     low         medium         HIGH            low
     risk        risk           risk            risk
\`\`\`

## Touch points

The new client call:

\`\`\`ts
async function createOrder(input: OrderInput): Promise<Order> {
  const res = await gateway.post("/orders", input);
  return res.data;
}
\`\`\`

The validation hook (Python):

\`\`\`python
def validate_order(order: dict) -> list[str]:
    errors = []
    if order["total"] < 0:
        errors.append("total must be non-negative")
    return errors
\`\`\`

And the feature-flag check:

\`\`\`js
if (flags.enabled("orders-v2")) {
  route(request, ordersV2);
}
\`\`\`
`,
  questions: [
    {
      id: "reviewer",
      kind: "text",
      label: "Your name",
      placeholder: "e.g. Ramy",
      required: true,
      tab: "Verdict",
    },
    {
      id: "verdict",
      kind: "single",
      label: "Overall verdict",
      required: true,
      tab: "Verdict",
      options: [
        { value: "Approve", markdown: "### Approve\n\nShip it as designed — no blocking concerns." },
        {
          value: "Approve with changes",
          markdown:
            "### Approve with changes\n\nDirection is right; land the noted changes before merging.",
        },
        {
          value: "Request changes",
          markdown: "### Request changes\n\nBlocking concerns remain — needs another pass.",
        },
        {
          value: "Needs discussion",
          markdown: "### Needs discussion\n\nOpen questions are better resolved live than in review.",
        },
      ],
    },
    {
      id: "confidence",
      kind: "scale",
      label: "Confidence in this design (1 = shaky, 5 = solid)",
      min: 1,
      max: 5,
      step: 1,
      required: true,
      tab: "Verdict",
    },
    {
      id: "phases_ok",
      kind: "multi",
      label: "Which rollout phases look safe to you?",
      tab: "Rollout",
      options: [
        {
          value: "Phase 1 — read path",
          markdown:
            "### Phase 1 — read path\n\nServe reads from the new service behind a flag. Fully reversible; lowest risk.\n\n```text\nclient ──▶ gateway ──▶ [flag: orders-v2?]\n                         │ on  ──▶ Orders Service ──▶ (Orders DB)\n                         └ off ──▶ Legacy monolith\n```",
        },
        {
          value: "Phase 2 — dual-write",
          markdown:
            "### Phase 2 — dual-write\n\nWrites go to both stores.\n\n```mermaid\nflowchart LR\n  A[Request] --> B[Legacy DB]\n  A --> C[(Orders DB)]\n```",
        },
        {
          value: "Phase 3 — cut over writes",
          markdown:
            "### Phase 3 — cut over writes\n\nThe new store becomes the source of truth. **Highest risk** — keep a fast rollback ready.",
        },
        {
          value: "Phase 4 — decommission",
          markdown:
            "### Phase 4 — decommission\n\nRemove the legacy path once metrics are stable for two weeks.",
        },
      ],
    },
    {
      id: "boundary_concerns",
      kind: "longtext",
      label: "Concerns about the orders/inventory/billing data boundary",
      placeholder: "What could leak across the seam?",
      tab: "Rollout",
    },
    {
      id: "dual_write",
      kind: "single",
      label: "Preferred dual-write strategy",
      tab: "Cutover",
      options: [
        {
          value: "Synchronous",
          markdown:
            "### Synchronous\n\nWrite to both stores in the same request — simplest to reason about, but the request fails if either store is down.\n\n```mermaid\nflowchart LR\n  A[Request] --> B[Legacy DB]\n  A --> C[(Orders DB)]\n```",
        },
        {
          value: "Async via queue",
          markdown:
            "### Async via queue\n\nEnqueue the write; a worker mirrors it to the new store. Resilient, but eventually consistent.\n\n```mermaid\nflowchart LR\n  A[Request] --> B[Legacy DB]\n  A --> Q[[Queue]]\n  Q --> W[Worker] --> C[(Orders DB)]\n```",
        },
        {
          value: "CDC from the DB log",
          markdown:
            "### CDC from the DB log\n\nCapture changes from the legacy WAL and replay them — no app changes, but adds a pipeline to operate.\n\n```ts\nonChange(\"orders\", (row) => ordersDb.upsert(row));\n```",
        },
      ],
    },
    {
      id: "load_test",
      kind: "multi",
      label: "Which services must be load-tested before cutover?",
      options: ["Orders", "Inventory", "Billing", "API Gateway"],
      tab: "Cutover",
    },
    {
      id: "cutover_risk",
      kind: "scale",
      label: "Estimated cutover risk (1 = trivial, 10 = scary)",
      min: 1,
      max: 10,
      step: 1,
      required: true,
      tab: "Cutover",
    },
    {
      id: "rollback_owner",
      kind: "text",
      label: "Who owns the rollback runbook?",
      placeholder: "Name or team",
      tab: "Sign-off",
    },
    {
      id: "diagram_gaps",
      kind: "longtext",
      label: "Anything missing from the architecture diagram?",
      tab: "Sign-off",
    },
    {
      id: "timeline",
      kind: "single",
      label: "When should this land?",
      options: ["This quarter", "Next quarter", "Later"],
      required: true,
      tab: "Sign-off",
    },
    {
      id: "signoffs",
      kind: "multi",
      label: "Which sign-offs are required?",
      options: ["Security", "SRE", "Data", "Product"],
      tab: "Sign-off",
    },
    {
      id: "effort",
      kind: "scale",
      label: "Rough effort estimate (engineer-weeks)",
      min: 1,
      max: 12,
      step: 1,
      tab: "Sign-off",
    },
    {
      id: "notes",
      kind: "longtext",
      label: "Anything else?",
      placeholder: "Optional",
      tab: "Sign-off",
    },
  ],
};
