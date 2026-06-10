/**
 * Public API for the browser-plan session store. The session id is the primary key;
 * everything (asks, plan versions) is persisted under `<dataRoot>/sessions/<id>/`.
 *
 * CONTRACT NOTE: the exported names below are the frozen surface other units
 * build against. The async CRUD bodies are stubs here — Unit 1 implements them
 * (and may add internal helper modules such as paths.ts / fs-utils.ts /
 * lock.ts), but must keep these signatures and keep the public exports flowing
 * through this file so `index.ts` stays stable.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AskUserInput } from "../ask-user-app/src/questions";
import type {
  AskIndexEntry,
  AskRecord,
  PlanIndexEntry,
  PlanMeta,
  ResolveAskResult,
  SessionRecord,
} from "./types";
import { atomicWriteJson, atomicWriteText } from "./fs-utils";
import { withSessionLock } from "./lock";
import {
  asksDir,
  askRelPath,
  plansDir,
  sessionJsonPath,
} from "./paths";

/** Thrown when a session id is unknown (invalid, or no dir on disk). */
export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`browser-plan session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
  }
}

/**
 * Matches a canonical UUID (any version). Used as a path-traversal guard before
 * a session id is ever joined into a filesystem path. Mirrors what the Zod
 * `.uuid()` validator accepts at the tool boundary (defense in depth).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Storage root: `$BROWSER_PLAN_DATA_DIR` if set, else `~/.browser-plan`. Pure; no I/O. */
export function dataRoot(): string {
  const override = process.env.BROWSER_PLAN_DATA_DIR?.trim();
  return override && override.length > 0 ? override : join(homedir(), ".browser-plan");
}

/** Absolute path to a session's directory. Caller must pass a valid UUID. */
export function sessionDir(sessionId: string): string {
  return join(dataRoot(), "sessions", sessionId);
}

/** True iff `s` is a syntactically valid UUID (the path-traversal guard). */
export function isValidSessionId(s: string): boolean {
  return UUID_RE.test(s);
}

/** Read and parse `session.json`, or return null if it is missing/unreadable. */
async function readSessionJson(sessionId: string): Promise<SessionRecord | null> {
  try {
    const raw = await readFile(sessionJsonPath(sessionId), "utf8");
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
}

/** Create the session dir + `session.json` and return the new record. */
export async function createSession(opts: {
  projectPath: string;
  title?: string;
  intent?: string;
}): Promise<SessionRecord> {
  const sessionId = randomUUID();
  const now = new Date().toISOString();

  // Create the session dir and its subdirs upfront so later writes never race
  // on a missing parent. A fresh UUID has no contention, so no lock is needed.
  await mkdir(asksDir(sessionId), { recursive: true });
  await mkdir(plansDir(sessionId), { recursive: true });

  const record: SessionRecord = {
    schemaVersion: 1,
    sessionId,
    projectPath: opts.projectPath,
    ...(opts.title !== undefined ? { title: opts.title } : {}),
    ...(opts.intent !== undefined ? { intent: opts.intent } : {}),
    createdAt: now,
    updatedAt: now,
    latestPlanVersion: null,
    planCount: 0,
    askCount: 0,
    asks: [],
    plans: [],
  };

  await atomicWriteJson(sessionJsonPath(sessionId), record);
  return record;
}

/**
 * Assert a session exists on disk and return its record. Throws
 * `SessionNotFoundError` if the id is invalid or the session is missing.
 */
export async function assertSession(sessionId: string): Promise<SessionRecord> {
  if (!isValidSessionId(sessionId)) {
    throw new SessionNotFoundError(sessionId);
  }
  const record = await readSessionJson(sessionId);
  if (record === null) {
    throw new SessionNotFoundError(sessionId);
  }
  return record;
}

/**
 * Permanently remove a session's directory and everything under it (asks +
 * plan versions). Idempotent: a missing/already-deleted session is a no-op.
 * Throws `SessionNotFoundError` only for a syntactically invalid id (the
 * path-traversal guard). Serialized per id so it can't race a concurrent write.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  if (!isValidSessionId(sessionId)) {
    throw new SessionNotFoundError(sessionId);
  }
  return withSessionLock(sessionId, async () => {
    await rm(sessionDir(sessionId), { recursive: true, force: true });
  });
}

/**
 * Write a `pending` ask record and add its index entry to `session.json`.
 * Returns the new `askId` and the record's session-relative file path.
 */
export async function appendPendingAsk(
  sessionId: string,
  input: AskUserInput,
): Promise<{ askId: string; file: string }> {
  await assertSession(sessionId);
  const askId = randomUUID();
  const now = new Date().toISOString();
  const file = askRelPath(now, askId);

  const record: AskRecord = {
    schemaVersion: 1,
    askId,
    sessionId,
    status: "pending",
    createdAt: now,
    answeredAt: null,
    title: input.title,
    input,
    answers: null,
    outcome: null,
  };

  return withSessionLock(sessionId, async () => {
    // Re-read inside the lock so we serialize on the freshest session.json.
    const session = await readSessionJson(sessionId);
    if (session === null) {
      throw new SessionNotFoundError(sessionId);
    }

    await atomicWriteJson(join(sessionDir(sessionId), file), record);

    const entry: AskIndexEntry = {
      askId,
      file,
      title: input.title,
      status: "pending",
      createdAt: now,
      answeredAt: null,
    };
    session.asks.push(entry);
    session.askCount += 1;
    session.updatedAt = new Date().toISOString();
    await atomicWriteJson(sessionJsonPath(sessionId), session);

    return { askId, file };
  });
}

/** Apply a `ResolveAskResult` onto an ask record (status/answers/outcome). */
function applyResolution(record: AskRecord, result: ResolveAskResult): void {
  switch (result.kind) {
    case "answered":
      record.status = "answered";
      record.answers = result.answers;
      record.outcome = null;
      break;
    case "timeout":
      record.status = "timeout";
      record.answers = null;
      record.outcome = { type: "timeout" };
      break;
    case "declined":
      record.status = "declined";
      record.answers = null;
      record.outcome = { type: "decline", action: result.action };
      break;
    case "error":
      record.status = "error";
      record.answers = null;
      record.outcome = { type: "error", detail: result.detail };
      break;
  }
}

/** Locate an ask's session-relative file path, preferring the session index. */
async function findAskFile(
  session: SessionRecord,
  sessionId: string,
  askId: string,
): Promise<string | null> {
  const indexed = session.asks.find((a) => a.askId === askId);
  if (indexed) {
    return indexed.file;
  }
  // Fallback: scan the asks dir for a file ending in `-<askId>.json`.
  try {
    const names = await readdir(asksDir(sessionId));
    const match = names.find((n) => n.endsWith(`-${askId}.json`));
    return match ? `asks/${match}` : null;
  } catch {
    return null;
  }
}

/**
 * Patch an existing ask record with its terminal outcome and update the
 * matching index entry's status/answeredAt in `session.json`.
 */
export async function resolveAsk(
  sessionId: string,
  askId: string,
  result: ResolveAskResult,
): Promise<void> {
  await assertSession(sessionId);

  return withSessionLock(sessionId, async () => {
    const session = await readSessionJson(sessionId);
    if (session === null) {
      throw new SessionNotFoundError(sessionId);
    }

    const file = await findAskFile(session, sessionId, askId);
    if (file === null) {
      throw new Error(`browser-plan store: ask not found: ${askId}`);
    }

    const absPath = join(sessionDir(sessionId), file);
    let record: AskRecord;
    try {
      record = JSON.parse(await readFile(absPath, "utf8")) as AskRecord;
    } catch {
      throw new Error(`browser-plan store: ask file unreadable: ${file}`);
    }

    const answeredAt = new Date().toISOString();
    applyResolution(record, result);
    record.answeredAt = answeredAt;
    await atomicWriteJson(absPath, record);

    const entry = session.asks.find((a) => a.askId === askId);
    if (entry === undefined) {
      throw new Error(`browser-plan store: ask index entry not found: ${askId}`);
    }
    entry.status = record.status;
    entry.answeredAt = answeredAt;
    session.updatedAt = new Date().toISOString();
    await atomicWriteJson(sessionJsonPath(sessionId), session);
  });
}

/**
 * Allocate the next version, write `plans/v<N>.md` + `plans/v<N>.json`, bump
 * `latestPlanVersion`/`planCount`/`plans[]` in `session.json`, return the meta.
 */
export async function appendPlanVersion(
  sessionId: string,
  plan: string,
  opts: { title?: string },
): Promise<PlanMeta> {
  await assertSession(sessionId);

  return withSessionLock(sessionId, async () => {
    const session = await readSessionJson(sessionId);
    if (session === null) {
      throw new SessionNotFoundError(sessionId);
    }

    const next = (session.latestPlanVersion ?? 0) + 1;
    const now = new Date().toISOString();
    const mdName = `v${next}.md`;
    const jsonName = `v${next}.json`;
    const dir = plansDir(sessionId);

    const meta: PlanMeta = {
      schemaVersion: 1,
      sessionId,
      version: next,
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      createdAt: now,
      file: mdName,
      bytes: Buffer.byteLength(plan, "utf8"),
    };

    // Write order matters: markdown first, then the sidecar, then session.json.
    // A reader following an index entry will always find its file present.
    await atomicWriteText(join(dir, mdName), plan);
    await atomicWriteJson(join(dir, jsonName), meta);

    const entry: PlanIndexEntry = {
      version: next,
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      file: `plans/${mdName}`,
      createdAt: now,
    };
    session.plans.push(entry);
    session.latestPlanVersion = next;
    session.planCount += 1;
    session.updatedAt = new Date().toISOString();
    await atomicWriteJson(sessionJsonPath(sessionId), session);

    return meta;
  });
}
