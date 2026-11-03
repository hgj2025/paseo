import { describe, expect, it } from "vitest";
import type { FetchAgentTimelinePayload } from "@getpaseo/client/internal/daemon-client";
import { diagnosticHistoryRequest, readDiagnosticPage } from "./history";
function page(seq: number, epoch = "v1"): FetchAgentTimelinePayload {
  return {
    requestId: "req",
    agentId: "a",
    agent: null,
    direction: "tail",
    projection: "projected",
    epoch,
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 1, maxSeq: seq, nextSeq: seq + 1 },
    startCursor: { epoch, seq },
    endCursor: { epoch, seq },
    hasOlder: true,
    hasNewer: false,
    error: null,
    entries: [
      {
        provider: "codex",
        item: {
          id: `call-${seq}`,
          type: "tool_call",
          callId: String(seq),
          name: "shell",
          status: "completed",
          error: null,
          detail: { type: "shell", command: "pwd", exitCode: 0 },
        },
        timestamp: new Date(seq * 1000).toISOString(),
        seqStart: seq,
        seqEnd: seq,
        sourceSeqRanges: [],
        collapsed: [],
        turnId: "t",
      },
    ],
  };
}
describe("isolated diagnostic history", () => {
  it("paginates through real cursors without touching chat state", () => {
    const first = readDiagnosticPage(page(2));
    expect(diagnosticHistoryRequest(first)).toMatchObject({
      direction: "before",
      cursor: { epoch: "v1", seq: 2 },
    });
    const older = { ...page(1), direction: "before" as const };
    const next = readDiagnosticPage(older, first);
    expect(next.items).toHaveLength(2);
    expect(first.items).toHaveLength(1);
    expect(readDiagnosticPage(older, next).items).toHaveLength(2);
  });
  it.each(["epoch", "reset", "staleCursor", "gap"])(
    "does not stitch incompatible history after %s",
    (reason) => {
      const first = readDiagnosticPage(page(2));
      const next = { ...page(1), direction: "before" as const };
      if (reason === "epoch") next.epoch = "v2";
      else next[reason as "reset" | "staleCursor" | "gap"] = true;
      expect(readDiagnosticPage(next, first).items).toHaveLength(1);
    },
  );
});
