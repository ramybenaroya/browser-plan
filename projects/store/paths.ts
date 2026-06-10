/**
 * Path helpers for the on-disk session layout:
 *
 *   <dataRoot>/sessions/<sessionId>/
 *     session.json
 *     asks/<utcTs>-<askId>.json
 *     plans/v<N>.md
 *     plans/v<N>.json
 *
 * `dataRoot` / `sessionDir` live in store.ts (frozen public surface); these are
 * the internal joins layered on top of `sessionDir`.
 */
import { join } from "node:path";
import { sessionDir } from "./store";

/** Absolute path to `<sessionId>/session.json`. */
export function sessionJsonPath(sessionId: string): string {
  return join(sessionDir(sessionId), "session.json");
}

/** Absolute path to the `asks/` directory for a session. */
export function asksDir(sessionId: string): string {
  return join(sessionDir(sessionId), "asks");
}

/** Absolute path to the `plans/` directory for a session. */
export function plansDir(sessionId: string): string {
  return join(sessionDir(sessionId), "plans");
}

/**
 * Compact UTC timestamp used to name ask files, e.g. "20260607T182110123Z".
 * Strips the `-`, `:`, and `.` separators from an ISO string.
 */
export function compactUtcTs(iso: string): string {
  return iso.replace(/[-:.]/g, "");
}

/** Session-relative path of an ask record file: "asks/<ts>-<askId>.json". */
export function askRelPath(iso: string, askId: string): string {
  return `asks/${compactUtcTs(iso)}-${askId}.json`;
}
