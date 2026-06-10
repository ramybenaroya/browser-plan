/**
 * Read-only helpers for consuming the on-disk session store — used by the
 * retrospective app (`plans-retro`). Never writes. Every id is validated as a
 * UUID (and version as a positive int) before it is joined into a path, so a
 * request param can't escape the sessions tree.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { dataRoot, sessionDir, isValidSessionId, assertSession } from "./store";
import { asksDir, plansDir } from "./paths";
import type { SessionRecord, AskRecord, PlanMeta } from "./types";

/** Absolute path to the `sessions/` directory under the data root. */
export function sessionsDir(): string {
  return join(dataRoot(), "sessions");
}

/**
 * Every readable session, newest activity first. Skips entries whose name isn't
 * a valid session id or whose `session.json` is missing/unreadable. Returns an
 * empty array when the sessions directory doesn't exist yet.
 */
export async function listSessions(): Promise<SessionRecord[]> {
  let names: string[];
  try {
    names = await readdir(sessionsDir());
  } catch {
    return [];
  }

  const records = await Promise.all(
    names.filter(isValidSessionId).map(async (id) => {
      try {
        return await assertSession(id);
      } catch {
        return null;
      }
    }),
  );

  return records
    .filter((r): r is SessionRecord => r !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Read a single ask record by id, or null if the session/ask is unknown. Locates
 * the file via the session's `asks[]` index, falling back to scanning the asks
 * directory for a `*-<askId>.json` file.
 */
export async function readAsk(
  sessionId: string,
  askId: string,
): Promise<AskRecord | null> {
  // askId is also a randomUUID(), so the session-id UUID guard fits it too.
  if (!isValidSessionId(sessionId) || !isValidSessionId(askId)) return null;

  let session: SessionRecord;
  try {
    session = await assertSession(sessionId);
  } catch {
    return null;
  }

  let file = session.asks.find((a) => a.askId === askId)?.file ?? null;
  if (file === null) {
    try {
      const names = await readdir(asksDir(sessionId));
      const match = names.find((n) => n.endsWith(`-${askId}.json`));
      file = match ? `asks/${match}` : null;
    } catch {
      return null;
    }
  }
  if (file === null) return null;

  try {
    return JSON.parse(
      await readFile(join(sessionDir(sessionId), file), "utf8"),
    ) as AskRecord;
  } catch {
    return null;
  }
}

/**
 * Read a plan version's markdown + metadata, or null if the session/version is
 * unknown.
 */
export async function readPlan(
  sessionId: string,
  version: number,
): Promise<{ markdown: string; meta: PlanMeta } | null> {
  if (!isValidSessionId(sessionId) || !Number.isInteger(version) || version < 1) {
    return null;
  }
  try {
    await assertSession(sessionId);
  } catch {
    return null;
  }

  const dir = plansDir(sessionId);
  try {
    const markdown = await readFile(join(dir, `v${version}.md`), "utf8");
    const meta = JSON.parse(
      await readFile(join(dir, `v${version}.json`), "utf8"),
    ) as PlanMeta;
    return { markdown, meta };
  } catch {
    return null;
  }
}
