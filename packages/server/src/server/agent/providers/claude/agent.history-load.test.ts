import { writeFileSync, chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ClaudeAgentClient } from "./agent.js";
import { claudeProjectDirSync } from "./project-dir.js";

/**
 * A resumed Claude agent whose transcript is missing or unreadable opens with an empty timeline.
 * The daemon log at its default level has to say which, and where it looked.
 */

const SESSION_ID = "history-load-session";

interface LogRecord {
  level: number;
  msg: string;
  sessionId?: string;
  historyPath?: string;
  err?: { message?: string };
}

describe("ClaudeAgentSession persisted history load", () => {
  let tempRoot: string;
  let cwd: string;
  let configDir: string;
  let records: LogRecord[];

  async function resume(): Promise<void> {
    const client = new ClaudeAgentClient({
      logger: pino({ level: "info" }, { write: (line: string) => records.push(JSON.parse(line)) }),
      queryFactory: vi.fn(() => {
        throw new Error("history load must not start a query");
      }),
      resolveVersion: async () => "2.1.220",
    });
    const session = await client.resumeSession(
      { provider: "claude", sessionId: SESSION_ID },
      { cwd },
    );
    await session.close();
  }

  function transcriptPath(): string {
    return path.join(claudeProjectDirSync(cwd, { configDir }), `${SESSION_ID}.jsonl`);
  }

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), "claude-history-load-"));
    cwd = path.join(tempRoot, "repo");
    configDir = path.join(tempRoot, "claude-config");
    mkdirSync(cwd, { recursive: true });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    records = [];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test.each([false, true])(
    "diagnostic snapshots cannot reopen a settled tool (isError=%s)",
    async (isError) => {
      mkdirSync(path.dirname(transcriptPath()), { recursive: true });
      const tool = {
        type: "tool_use",
        id: "settled-call",
        name: "Bash",
        input: { command: "echo done" },
      };
      const result = {
        type: "tool_result",
        tool_use_id: "settled-call",
        content: "actual result",
        is_error: isError,
      };
      const transcriptRecords = [
        {
          type: "user",
          uuid: "prompt",
          timestamp: "2026-11-22T01:00:00.000Z",
          message: { role: "user", content: "run it" },
        },
        {
          type: "assistant",
          uuid: "call",
          timestamp: "2026-11-22T01:00:01.000Z",
          message: { role: "assistant", content: [tool] },
        },
        {
          type: "api-request-blob",
          message: { role: "user", content: [{ ...result, content: "diagnostic copy" }] },
        },
        {
          type: "user",
          uuid: "result",
          timestamp: "2026-11-22T01:00:02.000Z",
          message: { role: "user", content: [result] },
        },
        { type: "api-request-blob", message: { role: "assistant", content: [tool] } },
        {
          type: "assistant",
          uuid: "reply",
          timestamp: "2026-11-22T01:00:03.000Z",
          message: { role: "assistant", content: [{ type: "text", text: "done" }] },
        },
      ];
      writeFileSync(
        transcriptPath(),
        transcriptRecords.map((record) => JSON.stringify(record)).join("\n"),
      );
      const queryFactory = vi.fn(() => {
        throw new Error("history replay must not execute tools");
      });
      const client = new ClaudeAgentClient({
        logger: pino({ level: "silent" }),
        queryFactory,
        resolveVersion: async () => "2.1.220",
      });
      const session = await client.resumeSession(
        { provider: "claude", sessionId: SESSION_ID },
        { cwd },
      );
      try {
        const events = [];
        for await (const event of session.streamHistory()) events.push(event);
        const tools = events.filter(
          (event) => event.type === "timeline" && event.item.type === "tool_call",
        );
        expect(
          tools.map((event) =>
            event.type === "timeline" && event.item.type === "tool_call" ? event.item.status : null,
          ),
        ).toEqual(["running", isError ? "failed" : "completed"]);
        expect(tools.map((event) => (event.type === "timeline" ? event.timestamp : null))).toEqual([
          "2026-11-22T01:00:01.000Z",
          "2026-11-22T01:00:02.000Z",
        ]);
        expect(JSON.stringify(events)).not.toContain("diagnostic copy");
        expect(queryFactory).not.toHaveBeenCalled();
      } finally {
        await session.close();
      }
    },
  );

  test("re-reads completed external history without starting a query or duplicating rows", async () => {
    mkdirSync(path.dirname(transcriptPath()), { recursive: true });
    const message = (id: string, text: string) =>
      JSON.stringify({
        type: "assistant",
        uuid: id,
        timestamp: "2026-11-22T11:30:00.000Z",
        message: { role: "assistant", content: [{ type: "text", text }] },
      });
    writeFileSync(transcriptPath(), message("first", "before"));
    const queryFactory = vi.fn(() => {
      throw new Error("must not start a query");
    });
    const client = new ClaudeAgentClient({
      logger: pino({ level: "silent" }),
      queryFactory,
      resolveVersion: async () => "2.1.220",
    });
    const session = await client.resumeSession(
      { provider: "claude", sessionId: SESSION_ID },
      { cwd },
    );
    try {
      for await (const _ of session.streamHistory()) {
        /* consume the original import */
      }
      writeFileSync(
        transcriptPath(),
        message("first", "before") + "\n" + message("last", "completed externally"),
      );
      const read = async () => {
        const events = [];
        for await (const event of session.readPersistedHistory!()) events.push(event);
        return events;
      };
      const events = await read();
      expect(JSON.stringify(events)).toContain("completed externally");
      expect(await read()).toEqual(events);
      expect(session.id).toBe(SESSION_ID);
      expect(queryFactory).not.toHaveBeenCalled();
      writeFileSync(transcriptPath(), "");
      await expect(read()).rejects.toThrow("no replayable history");
      rmSync(transcriptPath());
      await expect(read()).rejects.toThrow();
    } finally {
      await session.close();
    }
  });

  test("logs the resolved transcript path when the transcript does not exist", async () => {
    await resume();

    expect(records).toContainEqual(
      expect.objectContaining({
        level: pino.levels.values.info,
        msg: "No Claude transcript to load history from",
        sessionId: SESSION_ID,
        historyPath: transcriptPath(),
      }),
    );
  });

  test("logs a warning with the error when the transcript cannot be read", async () => {
    // A directory at the transcript path exists but cannot be read as a file.
    mkdirSync(transcriptPath(), { recursive: true });

    await resume();

    expect(records).toContainEqual(
      expect.objectContaining({
        level: pino.levels.values.warn,
        msg: "Failed to load Claude history from transcript",
        sessionId: SESSION_ID,
        historyPath: transcriptPath(),
        err: expect.objectContaining({ message: expect.stringContaining("EISDIR") }),
      }),
    );
  });

  // chmod does not remove read access on Windows, or for root.
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "logs a warning with the error when Claude's project folders cannot be listed",
    async () => {
      // The transcript is not under cwd's folder, so the lookup lists the other project folders.
      mkdirSync(path.join(configDir, "projects"), { recursive: true });
      chmodSync(path.join(configDir, "projects"), 0o000);

      try {
        await resume();
      } finally {
        chmodSync(path.join(configDir, "projects"), 0o755);
      }

      expect(records).toContainEqual(
        expect.objectContaining({
          level: pino.levels.values.warn,
          msg: "Failed to load Claude history from transcript",
          sessionId: SESSION_ID,
          err: expect.objectContaining({ message: expect.stringContaining("EACCES") }),
        }),
      );
    },
  );
});
