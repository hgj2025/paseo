import type {
  FetchAgentTimelinePayload,
  FetchAgentTimelineOptions,
} from "@getpaseo/client/internal/daemon-client";
import { hydrateStreamState, type StreamItem } from "@/types/stream";

export type HistoryCursor = NonNullable<FetchAgentTimelinePayload["startCursor"]>;
export interface DiagnosticHistory {
  items: StreamItem[];
  epoch: string;
  cursor: HistoryCursor | null;
  hasOlder: boolean;
}
export function readDiagnosticPage(
  page: FetchAgentTimelinePayload,
  previous?: DiagnosticHistory,
): DiagnosticHistory {
  const items = hydrateStreamState(
    page.entries.map((entry) => ({
      event: {
        type: "timeline" as const,
        provider: entry.provider,
        item: entry.item,
        ...(entry.turnId ? { turnId: entry.turnId } : {}),
      },
      timestamp: new Date(entry.timestamp),
      timelineCursor: { epoch: page.epoch, seq: entry.seqEnd },
    })),
    { source: "canonical" },
  );
  const retain =
    previous &&
    page.direction === "before" &&
    previous.epoch === page.epoch &&
    !page.reset &&
    !page.staleCursor &&
    !page.gap;
  const merged = new Map<string, StreamItem>();
  for (const item of [...items, ...(retain ? previous.items : [])]) merged.set(item.id, item);
  const bounded = Array.from(merged.values()).slice(-2000);
  return {
    items: bounded,
    epoch: page.epoch,
    cursor: page.startCursor,
    hasOlder: page.hasOlder && merged.size < 2000,
  };
}
export function diagnosticHistoryRequest(previous?: DiagnosticHistory): FetchAgentTimelineOptions {
  return previous?.cursor
    ? { direction: "before", cursor: previous.cursor, limit: 200, projection: "projected" }
    : { direction: "tail", limit: 200, projection: "projected" };
}
