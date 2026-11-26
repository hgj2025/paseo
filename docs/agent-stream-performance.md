# Agent stream performance

How assistant text gets from a provider to the screen, and why it is paced on the way. Read this before changing `packages/server/src/server/agent/agent-stream-coalescer.ts`, the reducer queue in `packages/app/src/timeline/session-stream-reducers.ts`, or the reveal in `packages/app/src/hooks/use-revealed-text.ts`.

For terminal output, which is a separate pipeline with separate budgets, see [terminal-performance.md](terminal-performance.md).

## The pipeline

```
provider deltas (every provider streams incrementally)
  → AgentStreamCoalescer (daemon, leading + trailing, ≤1 message per 60ms per agent)
  → recordTimeline: one canonical row per flushed item
  → agent_stream ws message
  → reducer queue (app, one commit per frame) → session store
  → source-item plugin transforms → native Markdown blocks / tool grouping
  → paced reveal (app, per displayed item) → paint
```

Every provider delivers incremental text, so there is no provider that needs special handling: Claude via `includePartialMessages`, Codex via `agent_message_delta`, ACP agents via `agent_message_chunk`, Pi and OMP via `text_delta`.

## Client execution diagnostics

Mac settings exposes Session execution diagnostics from a row inside Diagnostics. The detail route
keeps Diagnostics selected in the sidebar and provides a return action; it is not a separate sidebar
section. There is no diagnostic control in chat panes. An App-root observer passively consumes stream state already received for each
Host/Agent, without acquiring directory or timeline demand. Updates are coalesced at 500 ms;
a one-second clock advances observed running intervals. App hiding or a connection gap invalidates
unfinished timing. The collector never reruns commands or changes provider outcomes.

Only redacted derived records and timing observations enter the memory-only LRU cache: at most
40 sessions and 200 rows per session. Closing settings does not stop collection; closing the App
loses this cache. Session list entries without evidence say Not analyzed rather than zero failures.

The settings page uses the existing paginated history directory for one selected Host. Explicit
history reads use that Host's existing client without subscribing to the agent, starting its runtime,
or changing the chat's viewed-timeline ownership. A selection owns at most 2,000 historical items;
stale async responses are discarded. Epoch changes, gaps and invalid cursors reset that selection's
history. Diagnostic evidence does not establish full-session coverage.

Provider duration is distinguished from a monotonic client observation window, which may include
approval waiting. History timestamps alone cannot establish tool duration; parallel durations are
not summed into wall time. Retry links require an exact single shell command in the same turn,
epoch and working directory. Later exit zero means that command later succeeded, not a proven code
fix. Compound commands and missing turn IDs remain unlinked. Search exit one remains reviewable
unless stronger evidence establishes no-match intent. Original failed records are never suppressed.

## Why the reveal is paced

Arrival is lumpy and there is no fixing that at the source. A 60ms coalescing window carries however many characters the model produced in those 60ms, which swings by an order of magnitude within a single turn. Painting each delta as it lands makes the size of those lumps visible, and that is what reads as jagged.

So arrival sets a _target_ and the reveal rate is derived from the backlog instead. A burst makes the text catch up faster; it does not make the text jump. Shrinking the coalescing window does not fix this — it makes the lumps smaller and more frequent, at the cost of message rate on a daemon loop that already contends with terminal frames and per-message relay encryption.

## Invariants

- **The coalescer is leading + trailing.** The first delta after an idle window flushes synchronously; only the rest of the burst waits for the trailing timer. Reverting to trailing-only adds a full window to the first character of every turn. Same shape and the same reason as `TerminalOutputCoalescer`.
- **The leading flush adds a canonical row, and that is fine.** A burst's first chunk lands as its own timeline row. `mergeAssistantChunks` / `mergeReasoningChunks` in `timeline-projection.ts` join contiguous same-turn rows, and clients read the projected timeline, so history is unaffected. Tests that assert on raw rows have to account for the extra row; tests that assert on what a client sees do not.
- **The store holds the full text; only the rendered slice is paced.** Copy, selection, the chat outline, and scroll geometry all read the same string the user can see. Pacing the store instead would leave the bottom anchor chasing a content height that is ahead of the reveal.
- **Markdown blocks belong to presentation, and every assistant message is a block group.**
  `agent-stream/presentation.ts` splits a message into one display row per Markdown block, the same
  way whether it arrived streaming or as fetched history. Splitting in the reducer instead would
  discard paragraph separators and expose fragments to plugin callbacks, which need the whole source
  text. Live-head work stays cheap by parsing only the growing last block during append, retaining
  completed blocks by object identity, and caching the split per source item so a tail change does
  not re-split history. History was once left whole to keep cross-block Markdown context; that gave
  one message two shapes depending on how it arrived, and message-addressed features only worked on
  one of them.
- **A row id is never a message id.** Block rows are `${messageId}:block:${n}` with
  `blockGroupId = messageId`, including single-block messages, so nothing can come to rely on the two
  being equal. `getStreamItemMessageId` in `presentation.ts` is the only way to go from a row to its
  message, and web rows carry it as `data-message-id` alongside `data-history-row-id`. Anything
  addressing a message — chat find, scroll-to-message, history reveal, the find expansion that lifts
  the render cap — uses the message id and must expect several rows to answer to it. Row ids stay for
  React keys, virtualizer measurement, scroll anchors, and per-row caches like assistant image
  occurrence keys.
- **First sight of a text is revealed whole.** Only growth is paced. This is what makes history hydration, timeline replay, a virtualized row remounting on scroll, and an already-finished message all render complete on first paint without a special case for each.
- **Leaving `phase: "streaming"` snaps the reveal.** A completed turn must never be left holding characters. `layoutStream` sets the phase, so anything outside the live head with an active turn is already complete.
- **The reducer queue commits on a frame, with a timer as the ceiling.** A frame callback never fires in a hidden tab, so a timer races it and wins when nothing is painting — the store has to keep advancing either way.
- **A history row re-renders only when its item or layout item identity changes.** The inverted
  FlatList hands every mounted cell a new `index` and `ref` whenever a row is prepended, so without a
  memo boundary each coalesced tick re-rendered every mounted row (about 50 on a phone, 100–250 ms of
  JS per tick). `layoutStream` keeps a layout item's identity when nothing about it changed,
  `useRevisedHistoryRows` hands a fresh item identity to rows whose tool-call group, expanded state,
  or breakpoint changed, and `HistoryStreamRow` memoizes on both. Every viewport runs its history
  through that hook; the web viewport once skipped it and history hosts of a live tool group went
  stale. A new field on `StreamLayoutItem` must be added to `areLayoutItemsEquivalent`, or sharing
  silently stops.

## Measuring

- **Smoothness (user-perceived):** `packages/app/e2e/browser/agent-stream-smoothness.spec.ts`, gated behind `PASEO_AGENT_STREAM_PERF_E2E=1`. Drives the mock provider's `bursty-stream` model and reports coefficient of variation of characters painted per frame (smoothness) plus p95 gap between visible updates (stalls). Both numbers are needed: a stalled stream is perfectly smooth.
- **Reproducing bursty arrival:** the `bursty-stream` model in `mock-load-test-agent.ts` emits uneven runs of tokens separated by idle gaps. Burst sizes come from a seeded generator, so a run repeats exactly.
- **Rate policy in isolation:** `computeRevealStep` in `packages/app/src/agent-stream/text-reveal.ts` is pure; `text-reveal.test.ts` covers convergence and burst flattening without a renderer.

Healthy numbers (2026-08, Expo web against a local dev daemon, real Claude Haiku agent, ~8.5s samples during active streaming). Setting `TEXT_REVEAL_HORIZON_MS` to 0 makes the reveal paint on arrival, which is how the baseline column was taken:

|                                  | paint on arrival | paced |
| -------------------------------- | ---------------- | ----- |
| frames that advanced the text    | 6%               | 87%   |
| chars-per-frame CV               | 4.11             | 1.86  |
| gap between visible updates, p50 | 317ms            | 17ms  |
| gap between visible updates, p95 | 383ms            | 17ms  |

Total characters painted is roughly the same either way — the reveal changes when they land, not how many arrive.

Measure the **total** length across every `assistant-message` element, not the last one. A turn emits many assistant messages, so the tail element keeps changing identity and its length is not monotonic; sampling only the tail reads those handovers as resets and reports almost no growth. `sampleStreamFrames` does this correctly.

## Execution repository status reads

Composer execution context and session-files repository summaries share the canonical
`checkoutStatus` cache by host and directory. They do not poll Git every 5/10 seconds.
Known workspace status is updated by the existing daemon push stream. Additional repository
status is refreshed after structured shell/edit/write tools reach a terminal status (including
failure, since a failed command may have modified files). Bursts are coalesced for 250 ms,
and a newer push/read satisfies the refresh without another request. Concurrent surfaces
must not cancel and restart the same in-flight checkout read.

Text deltas and unchanged history pages are not refresh evidence. Hidden Apps and inactive
composer panes do not initiate these reads. Focus/reconnect repairs status for repositories
without a workspace subscription; external edits in an unsubscribed extra repository are
therefore reflected on focus or the next relevant tool completion, not by background polling.
Only the live stream head is rescanned for live text updates; stable historical tool evidence
is memoized independently. Session-files history retrieval remains separate from Git queries.

For desktop CPU diagnosis, distinguish the renderer from the GPU-process Helper. A manually
installed `LSEnvironment.PASEO_ELECTRON_FLAGS=--disable-gpu` in the App's Info.plist forces
software rendering. Remove that override and re-sign/restart the App before attributing
software-compositing CPU to agent execution. App restart must preserve the daemon and its tasks.

## Retained stream width

Web streams measure content width after commit and with ResizeObserver, not during
React rendering. Hidden/zero geometry must retain the last positive width: a retained
workspace is still display:none during its activation render, and treating that zero
as the current width discards measured row-height estimates. First virtualizer viewport
initialization remains separate from content-width measurement.

## Desktop navigation diagnostics

The desktop renderer writes `[navigation-perf]` JSON records to the existing Electron
app log (`~/Library/Logs/Paseo/main.log` on macOS). Each request has a window-local ID,
host/agent/workspace IDs, monotonic elapsed times, pointer/keyboard input queue delay,
workspace commit, authoritative content readiness, and two animation-frame opportunities.
A frame opportunity is not proof that the OS compositor displayed the pixels.
Each request collects at most 12 overlapping main-thread long tasks and ends on a frame
opportunity, superseding request, failure, or 5-second timeout. No idle polling occurs.
The log contains numeric counts and opaque IDs, never titles, messages, command output,
or paths. Renderer console forwarding uses the existing Electron log rotation.

After the two frame opportunities, navigation diagnostics retain one trace for five
seconds to attribute delayed history hydration long tasks. This adds no polling or
network reads. Slow (>16 ms) stream presentation and render-model calculations log
phase, duration and row count; delayed long-task records remain capped at 12 per
trace. These records distinguish first-screen readiness from later blocking work.

## Session history load hints

An App-memory cache retains observations for at most 200 host/agent pairs. Active
session titles and desktop conversation tabs show an amber triangle only when loaded
history reaches 10,000 source items, readiness waits reach 1,500 ms, or measured
stream processing reaches 200 ms. These centralized advisory budgets are independent
of provider token/context limits. The detail sheet distinguishes loaded counts from
full history and connection/synchronization wait from synchronous processing.

Counts reuse array lengths and timings reuse navigation instrumentation. Workspace/project
entry also observes the existing visible loading state with one cancellable 1.5-second
deadline, cleared on readiness, hiding or unmount. This is not a polling loop. There are
no additional reads, history scans, serialization or polling. Per-session subscribers
are notified only when observations change. Unopened/unmeasured sessions remain
unassessed; observations are cleared when the App closes.
