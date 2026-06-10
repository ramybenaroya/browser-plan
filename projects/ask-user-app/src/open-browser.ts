import { spawn } from "node:child_process";

/**
 * Open `url` in the user's default browser. Used by the MCP server when the
 * connected client can't open URLs itself (e.g. Claude Code CLI), and by the
 * `open-app` dev script — since browser-plan runs locally, it can launch the browser
 * directly. Errors are logged to stderr only (stdout is the JSON-RPC stream).
 */
export function openBrowser(url: string): void {
  // Escape hatch for tests / headless environments: skip the actual launch.
  if (process.env.ASK_NO_OPEN === "1") {
    console.error(`[browser-plan] ASK_NO_OPEN=1, not launching browser for: ${url}`);
    return;
  }
  let cmd: string;
  let args: string[];
  if (process.platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (process.platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", (err) =>
      console.error(`[browser-plan] failed to open browser (${cmd}): ${err.message}`),
    );
    child.unref();
  } catch (err) {
    console.error(
      `[browser-plan] failed to open browser: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
