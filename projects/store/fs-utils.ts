/**
 * Atomic file-write helpers for the store. Every write goes to a same-directory
 * temp file and is then `rename`d into place — `rename` within a directory is
 * atomic on POSIX/NTFS, and staying same-dir avoids EXDEV cross-device errors.
 * A reader therefore never observes a half-written file.
 */
import { randomUUID } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";

/** Atomically write a string to `path` (write temp + rename). */
export async function atomicWriteText(path: string, str: string): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, str, "utf8");
    await rename(tmp, path);
  } catch (err) {
    // Best-effort cleanup of the temp file; ignore unlink failures.
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Atomically write `obj` as pretty-printed JSON to `path`. */
export async function atomicWriteJson(path: string, obj: unknown): Promise<void> {
  await atomicWriteText(path, `${JSON.stringify(obj, null, 2)}\n`);
}
