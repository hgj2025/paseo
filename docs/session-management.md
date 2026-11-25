# Session history management

History owns metadata-only filtering and bulk selection. The sidebar remains the place to open current work; selection mode never navigates or resumes a session. Choose **Manage**, filter by host, archive state, provider ID or directory, and select loaded results. Loading more adds older results; **Select loaded** never claims to select unseen pages. Scope changes clear selection. Batch archive and restore report archived/restored, skipped and failed counts per operation. Restore uses the existing `refreshAgent` lifecycle and can recreate a provider runtime; it does not send a prompt.

## Archive safety

Archive retains Paseo history and provider persistence. It does not delete provider-native transcripts, code or worktrees. This UI offers no permanent-delete operation. Batch archive loads complete host metadata before acting and rereads each candidate immediately before the archive request. Running, initializing, error, open-turn, pending-permission and attention-needed sessions are excluded. Parents of unarchived children and child agents are excluded to avoid cascading an archive into other work. Workspace-pinned sessions are excluded. Automatic runs additionally protect sessions open/pinned in this app and unread completed results. Explicit manual batches may archive idle open tabs and unread completed results; they still exclude pending permissions and errors. Workspace metadata must be hydrated; unknown workspace ownership is protected. Other clients' open root-agent tabs are not centrally tracked by this feature.

The existing archive RPC is not a conditional transaction: a different client can start work between the final read and archive request. This app's own batch/automatic operations share a per-host lock, but cross-client atomic exclusion would require a daemon capability and coordinated rollout. Do not describe client checks as an atomic server guarantee.

## Daily archive rules

Choose a single host in History, then **Scheduled archive**. Rules are disabled by default and initially propose 30 days of inactivity. Each host can optionally restrict provider ID and an absolute directory (including descendants, matched on path boundaries). Preview fetches complete metadata and shows the candidate count and up to 20 titles/paths without changing data. Saving an enabled rule authorizes future archival, not permanent deletion.

Rules and the latest per-host report use validated AsyncStorage key `session-archive-rules-v1` on the coordinating device. Nothing is stored in relay, no daemon configuration or upgrade is required. The root `SessionArchiveCoordinator` owns a single next-due timer only while at least one rule is enabled. It runs on app startup/return to foreground and then once per 24 hours. A closed/suspended app does not execute; reopening performs one catch-up check, not one job per missed day. Offline hosts retry after five minutes; request failures retry after an hour. Disabling a rule or unmounting cancels future mutations after any in-flight request completes. The latest report displays time, archived/skipped/failed counts and errors.

No transcript load, Git invocation, provider-history discovery or short-interval per-session poll is added. Automatic runs read paginated Paseo metadata only; importing CLI history remains explicit. Configure the rule on one coordinating app, rather than independently enabling the same host rule on multiple devices.

## Code and checks

- `packages/app/src/session-management`: policy, validated persistence, rule form, UI, batch execution and coordinator.
- `screens/sessions-screen.tsx`, `components/agent-list.tsx`: existing History and virtualized list integration.
- `_layout.tsx`: one coordinator mount; no route or startup-selection change.
- Targeted tests cover path/age boundaries, protection rules, fresh-state checks, pagination, failure continuation, opt-in scheduling, daily cadence and offline retry.
