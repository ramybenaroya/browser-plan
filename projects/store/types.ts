/**
 * On-disk JSON types for the browser-plan session store. These are the shared
 * contract between the MCP server (writer) and the future retrospective app
 * (reader), so keep them stable and bump `schemaVersion` on breaking changes.
 *
 * The session id (a UUID minted by `init_browser_plan_session`) is the primary key
 * tying every questioning session and plan version together.
 */
import type { AskUserInput, Answers } from "../ask-user-app/src/questions";

/** Lifecycle of a single `ask_user` call. */
export type AskStatus = "pending" | "answered" | "timeout" | "declined" | "error";

/**
 * The non-answer terminal outcome of an ask. Mirrors the `Outcome` union in
 * the MCP server minus the `answers` case (answers live in `AskRecord.answers`).
 */
export interface AskOutcome {
  type: "timeout" | "decline" | "error";
  /** Present for `decline` — the elicitation action (e.g. "cancel", "decline"). */
  action?: string;
  /** Present for `error` — a human-readable detail string. */
  detail?: string;
}

/** A full ask record: one file per `ask_user` call under `asks/`. */
export interface AskRecord {
  schemaVersion: 1;
  askId: string;
  sessionId: string;
  status: AskStatus;
  createdAt: string;
  /** Set when the ask reaches any terminal status (doubles as "resolvedAt"). */
  answeredAt: string | null;
  /** Copied from `input.title` for cheap indexing. */
  title: string;
  /** The full question spec payload sent to `ask_user`. */
  input: AskUserInput;
  /** The collected answers when `status === "answered"`, else null. */
  answers: Answers | null;
  /** The terminal outcome for non-answer statuses, else null. */
  outcome: AskOutcome | null;
}

/** Lightweight ask entry denormalized into `session.json` for list views. */
export interface AskIndexEntry {
  askId: string;
  /** Path to the full record, relative to the session dir (e.g. "asks/…json"). */
  file: string;
  title: string;
  status: AskStatus;
  createdAt: string;
  answeredAt: string | null;
}

/** Metadata sidecar for a plan version: `plans/v<N>.json`. */
export interface PlanMeta {
  schemaVersion: 1;
  sessionId: string;
  version: number;
  title?: string;
  createdAt: string;
  /** The markdown file name, relative to the `plans/` dir (e.g. "v2.md"). */
  file: string;
  /** Size in bytes of the markdown file. */
  bytes: number;
}

/** Lightweight plan entry denormalized into `session.json` for list views. */
export interface PlanIndexEntry {
  version: number;
  title?: string;
  /** Path to the markdown, relative to the session dir (e.g. "plans/v2.md"). */
  file: string;
  createdAt: string;
}

/** The per-session manifest: `<sessionId>/session.json`. */
export interface SessionRecord {
  schemaVersion: 1;
  sessionId: string;
  /** Absolute path of the project this session was created for. */
  projectPath?: string;
  title?: string;
  intent?: string;
  createdAt: string;
  /** Bumped on every write that touches this session. */
  updatedAt: string;
  /** Version number of the most recent plan, or null before the first save. */
  latestPlanVersion: number | null;
  planCount: number;
  askCount: number;
  asks: AskIndexEntry[];
  plans: PlanIndexEntry[];
}

/** Terminal result handed to `resolveAsk`. */
export type ResolveAskResult =
  | { kind: "answered"; answers: Answers }
  | { kind: "timeout" }
  | { kind: "declined"; action: string }
  | { kind: "error"; detail: string };
