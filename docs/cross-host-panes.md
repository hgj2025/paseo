# Cross-host panes

A workspace window can show agents from several paired hosts. Its layout belongs to the
workspace that opened the window. Each scoped tab carries its own `serverId`, `workspaceId`,
and resource target. Moving or reopening a tab retains that binding.

## Conversation-owned teams

On hosts advertising `sessionTeams`, a workspace contains multiple top-level conversations.
Each conversation has its own team ID, Captain, child conversations, pane layout and saved
collaboration history. The sidebar conversation list switches the entire team; @ recipients never
come from another conversation in the same workspace.

- **New conversation** creates a Captain using the selected host's saved model or a model from
  an existing session in that workspace. If no usable model exists, the draft asks for one.
  Once a model is selected, the idle agent is created automatically, without sending a prompt.
- **Add member** chooses a paired host and workspace, then creates a separate child conversation
  in a new pane. Splitting has the same meaning, defaulting to the current workspace.
  On owners advertising `conversationExecution`, the model panel contains the host picker.
  Choosing a host stages a candidate; choosing a model commits the execution change. The
  conversation, member identity, pane, draft and history remain attached to their original IDs.
  The daemon saves the selected runner separately in `member.execution` and prior runners in
  `member.executionHistory`. A same-host, same-provider model change updates the existing runner.
  A host or provider change prepares a new runner with the paged transcript as quoted context,
  then commits the binding only if the member revision and source history checkpoint still match.
  Busy turns, unresolved team work, missing history and failed commits retain the previous binding.
  A finished error turn can switch once no active turn or permission remains; its error stays
  in the transcript. The toolbar keeps showing the committed model while the panel previews
  a candidate host and its catalog.
  No prior runner is archived by switching. Explicit member removal or conversation ending
  archives owned runners. Captain can change providers/models on the owner host; moving Captain
  to another host is blocked because its team tools and result delivery still live on the owner.
- An agent tab stays in its member's pane. Another agent opened through navigation selects its
  own top-level conversation. File, diff and terminal tabs are supporting views within member
  panes; the Explorer remains a workspace tool, not a team member.
- Each member has its own provider/model and real working directory on its own host. Names,
  prompt constraints can be edited inline under **Team → Members**. Captain stays bound to the
  main conversation.
- Captain follows the normal Paseo theme. Other panes use distinct, muted automatic colors;
  their **Team → Members → Pane color** control allows adjustment. The pane overflow menu only contains layout actions. Appearance is saved per conversation and
  member pane on this client, so switching conversations does not reuse another team's colors.
- **End conversation**, or closing Captain, archives agents created for that conversation.
  History remains stored after the conversation ends. A remote archive failure leaves the
  team in `ending` with a visible error and allows retry; it never reports a false success.
  Closing the app or switching conversations does not end a team.
- Removing a member archives its owned child session and retains the member identity in task
  history. Members with unresolved team work cannot be removed until that work is resolved or
  the conversation is ended. Independently attached legacy agents are not archived by team cleanup.

Layouts are client-local, atomically persisted with the active conversation index. Server-side
team records in `$PASEO_HOME/conversation-teams` are keyed by workspace **and** conversation. A client without local layouts can
restore a team's member panes from the daemon. Old workspace-wide records and layout snapshots
are preserved; they are never copied into every new conversation or merged by matching cwd.
Root-agent archive events also end their team, even when initiated outside the pane UI.

Accept an `@member` suggestion to insert its alias in the input. Each accepted roster alias
delimits that member’s instructions until the next mention; email addresses and file paths
do not select recipients. Captain's native
`list_team_members`, `send_team_task`, `get_team_tasks` and `plan_team_request` tools resolve the
caller's conversation before dispatch. Member prompt constraints guide the model and are
prepended to team tasks; direct messages do not receive that prefix. They do not enforce permissions.

The client displays saved runner histories before the current runner's transcript and keeps its
viewport keyed by the stable member. Reloading fetches those histories from their original hosts;
if a host is unavailable, a visible retry notice replaces a false claim that all history is loaded.
Transferred context is limited to 500,000 characters and is rejected rather than silently truncated.
Native CLI sessions differ across providers and hosts: continuity is provided by Paseo's stable
conversation and explicit transcript transfer. Workspaces are matched by exact directory path;
if no path matches, the user chooses the destination directory. This does not copy files, provider
credentials or live tools between hosts. The existing owner-to-worker bridge remains unchanged.

Pane headers show host and workspace names, not a second directory form. A shared directory
may have different paths on two hosts; equal workspace names do not imply a mapping. Files and
attachments remain scoped to their actual host. The owner daemon needs the new feature;
remote members continue using their existing creation, message and archive APIs.

Accepted tasks are watched by the host daemon even when the window closes. On completion it
reports to Captain once, waiting if Captain is busy. Permission requests stay with the user in the
target pane. Offline hosts retain the task; ambiguous acknowledgements never trigger automatic
resending. Daemon restart resumes saved watches and marks interrupted dispatches uncertain.
Conversation task/group history is retained. Legacy workspace teams still bound recent history;
Task-ID tombstones under `workspace-team-receipts` survive that pruning.
Persistent bridges reconcile those uncertain tasks automatically from the remote message ID
and timeline. Completion and permission events wake the owner immediately; a 30-second sweep
repairs missed events. Network requests run outside the persistence lock, and independent task
checks run with bounded concurrency. A slow or disconnected member does not lock team edits.

Member cards show task status and recent results; an uncertain task can be refreshed without
resending. Older remote CLI versions expose recent activity rather than a durable turn receipt,
so an uncorrelated quick completion remains uncertain and requires inspecting the conversation.
Do not manually interrupt or reuse a worker session while its team task is running.
Team dispatch currently accepts text; use the recipient's own pane for attachments.
The owner daemon must advertise `workspaceTeams` and `sessionTeams` for conversation-owned teams; older hosts can still be remote members.

Completion reports have a persisted message ID and a local delivery receipt. A lost report
acknowledgement can be reconciled without starting another Captain turn. Reports created before
this identity was introduced keep their uncertain state for manual inspection. A process crash
inside provider acceptance can still leave an outcome unknown; it is never a reason to submit
a new task ID automatically. Do not treat `idle` alone as evidence that a task succeeded.

## Cross-host agent tools

Same-host agents use the existing `send_agent_prompt` tool. Cross-host dispatch uses three
additional native Paseo MCP tools:

- `list_remote_agents`: with no arguments, lists configured host IDs; with `hostId`, lists that
  host's agents. Executable paths and connection credentials are not included in the response.
- `send_remote_agent_prompt`: requires `hostId`, a full `agentId` UUID, `requestId` UUID and prompt.
  It returns a dispatch receipt, not task completion. Reusing a request ID cannot resend a task.
- `wait_remote_agent`: waits for at most 30 seconds and returns status and recent output. A
  timeout means the task may still be running. Permission requests remain for the user to handle
  in the target pane. These lower-level tools require the caller to wait explicitly. Team tasks
  add durable tracking and automatic completion reports on top of the same bridge.

These tools bridge to an administrator-configured Paseo CLI. Pairing a host in the app alone
does not give the lead daemon a connection to it. Configure that connection on the lead machine
in `$PASEO_HOME/collaboration-hosts.json`, for example:

```json
{
  "version": 1,
  "hosts": [
    {
      "id": "the-paired-host-server-id",
      "label": "Mac mini",
      "command": ["/usr/bin/python3", "/absolute/path/to/vm-paseo.py"]
    }
  ]
}
```

The command must forward CLI arguments unchanged and print only Paseo's JSON on stdout. It
must support `agent ls --global`, `agent inspect`, `agent send --no-wait --prompt`, and
`agent wait --timeout`.
An authenticated SSH bridge or a Paseo CLI with an explicit `--host` target both work. The
bridge must target one specific daemon and must not fall back to a local daemon when offline.
The supplied Mac mini bridge resolves the VM address through the existing Lume integration.
No new relay or Cloudflare service is required. Captain's daemon must also enable
`daemon.mcp.injectIntoAgents`. An already loaded agent needs a reload while idle to receive new
native MCP tools; merely mentioning another host in a prompt does not install those tools.

### Persistent SSH application bridge

Set `"transport": "persistent"` on a configured host to reuse one multiplexed connection for
inspection, sending, waiting and task reconciliation. Omitting it retains the explicit CLI
transport; a failed persistent connection never falls back to a different endpoint or CLI.
Agent listing still uses the CLI command contract above.

The configured command must additionally accept `--rpc-worker <base64-module>`. It decodes the
module and runs `node --input-type=module -e <module> <cli-client-module> <remote-paseo-home>`
on the selected machine, forwarding stdin/stdout unchanged. `<cli-client-module>` is the installed
CLI's `dist/utils/client.js`. It connects locally using the remote CLI's existing credentials.
The module comes from the owner daemon's package, never from model or workspace input. The
Mac mini adapter uses SSH exec with strict host-key checks and `execvp`, so shutdown closes the
SSH channel and its worker instead of leaving an orphaned process. No SSH TCP forwarding,
new listening port, external relay, remote app replacement, or additional system service is needed.

The first frame verifies the daemon's server ID and application-channel version before any
operation is sent. Requests are correlated by ID, capped at 32 in flight, and bounded by timeouts
and frame sizes. A heartbeat detects dead connections; reconnect uses exponential backoff and
restores observations. Writes are never blindly replayed. `taskId` is passed as the native
`messageId`, reusing the remote daemon's durable message receipts across bridge restarts.
The receiver also stores task fingerprints and terminal results under
`$PASEO_HOME/collaboration-task-receipts`, with private file permissions. Once recorded, a result
survives later messages in that conversation. Full results remain there; large owner/UI reports
are explicitly marked as truncated. Permission requests remain for the human user.

The bridge uses the remote SDK's timeline subscriptions, message IDs and paged history APIs;
the installed Mac mini 0.11.2 privacy build has these APIs. Validate other installed versions
before enabling this transport. If history was cleared, a different user message intervened
before a terminal result was recorded, or provider acceptance remains ambiguous, the task stays
uncertain and is inspected rather than silently retried.

Only the daemon-local config selects executables; model input cannot choose a command or endpoint.
Commands use argument arrays, not shell interpolation. Receipts are stored under
`$PASEO_HOME/remote-agent-dispatches` with restrictive file modes. When an acknowledgement is lost,
the receipt stays uncertain: inspect the remote session before issuing a different request ID.
The UI gates coordination on the optional `remoteAgentCoordination` feature; older hosts can still
participate as ordinary remote agent panes.

## Team task overview

Member headers combine the alias, provider and read-only host status. Host selection lives in
that member’s model panel. The Explorer toggle belongs to the rightmost visible pane, and its
**+ → Team** item opens the layout owner’s team regardless of the focused member’s execution host.
The sidebar lists main conversations under their workspace and supports custom names.

Tasks, Activity and Members share owner-host data. Tasks can be searched by prompt, member or ID,
filtered by status and opened in a list/detail view. Compact layouts show one view at a time.
The Members tab has inline name/prompt editing, model/host metadata, pane colors and session
shortcuts. Prompt constraints are injected at team-task dispatch; changing them does not rewrite
already dispatched work. Existing protocol skills metadata is preserved when editing, but has no
separate UI field. Captain’s color follows the theme; other pane colors are local to this client
and conversation. **Open agent** retains the logical member while following its current executor.

The detail shows the saved prompt, output, task status and Captain-report delivery status.
Pending permission means an agent approval, not a clarification question; the user handles it
in the member’s own agent. Activity is explicitly the latest snapshot per task, not an invented
event log. Full conversations and tool output remain in the corresponding agent. Offline hosts
keep the cached view and disable refresh/edit actions. Current polling remains five seconds.

This view uses the existing v1 protocol. Conversation teams retain complete task history; legacy workspace teams keep bounded recent history. It does not add TaskRun,
clarification/reply, acceptance review or a full event archive. Lower-level remote prompts are not
retroactively converted into team tasks. The window’s host needs the team-enabled daemon; remote
members do not need a GUI update for this overview.

## Shared team composer and requests

Captain's composer stays open by default. Other enrolled team members start with a compact
footer and a **Message** button. Collapse preferences are saved by owner workspace and agent;
the composer stays mounted, preserving drafts, attachments and model settings. The footer keeps
an active agent's stop button. Permission requests remain in the member conversation.

Member mentions stay in the input. Each exact standalone `@alias` starts a section for that
member until the next mention. Repeated sections for the same member are combined in order.
Empty sections and unaddressed preambles reject submission before any task is sent. This avoids
silently assigning text to the wrong member. With no member mentions, the message goes to the
current agent. Addressed submissions create one persisted request with separate member prompts;
Captain receives the result but does not re-plan these instructions. Attachments are rejected
explicitly for team requests.

The API also retains coordinated and broadcast requests. Coordinated requests ask Captain to
call `plan_team_request`, assigning exactly one task to each selected member. Dependencies use
stable member IDs; cycles and missing members are rejected before dispatch. Broadcast requests
send the same instructions to every selected member. These modes share the persisted task,
retry and completion-report machinery with inline addressed requests.

The owner daemon advertises `workspaceTeamGroups`. The feature needs an owner daemon and renderer
upgrade; existing remote workers use the same send/observe bridge and do not need a group-aware
daemon or GUI. The protocol adds only optional fields to existing team/task responses.

A request stores its ID, mode, original prompt, sender, selected members, Captain, plan, dependency
edges, task-attempt IDs, timestamps, status, results and report receipt. Intent and stable task IDs
are saved before sending. Busy/offline members wait; their turns are not interrupted. Independent
members can start concurrently; dependent work receives completed prerequisite output. Large
context excerpts are truncated with an explicit pointer to the stored results, never by silently
cutting task instructions. Captain must read the stored original when a request exceeds its inline
preview. If no plan is committed when Captain finishes, the group becomes **Needs input**; the
user answers in the main conversation. This is conversation-based clarification, not an autonomous
agent negotiation protocol.

Group cards appear in Captain's conversation; a pending request appears above the composer until
its timeline message arrives. **Team → Requests** retains all recent groups and expandable member
instructions/results. **Tasks** retains individual attempts for diagnostics. Conversation teams retain all groups; legacy workspace teams keep up to
30 completed, reported groups plus unfinished requests. Request tombstones outlive visible history.
A confirmed failed member can be retried with a new attempt ID; completed members are preserved.
Uncertain delivery permits inspection only. Repeated submission/retry IDs are idempotent. When all
steps finish or fail, Captain receives one report; report retries reuse the same message ID. A
manual failed-member retry creates a new summary revision after that retry completes.

Verification uses isolated real daemons and mock model providers, not production conversations.
It covers multi-mention broadcast across hosts, a single timeline card, group details, per-member
draft collapse, restoration, dependency execution, queue recovery, partial retries, uncertain
acknowledgements, long inputs and Captain's MCP planning tool. Mock-provider tests prove transport
and state behavior; they do not guarantee that a model will choose a good decomposition.

## Implementation and checks

`workspace-tabs/scope.ts` resolves resource ownership. Pane callbacks wrap follow-up tabs in the
same scope. Panel attributes, dirty-editor retention and close confirmations stay keyed to the
layout owner. Scoped agents are included in the resource host's open-agent observation set,
and only visible scoped panes request streaming history. A disconnected owner does not replace
existing remote panes with a full-window offline gate.

Targeted tests cover scoped identity, persisted ownership, callback routing, safe view-only close,
MCP dispatch deduplication and uncertain acknowledgements. The browser scenario runs two isolated
real daemons with mock model providers and exercises both chat panes, member naming, explicit
`@` dispatch, automatic completion reporting, reload persistence, CLI-backed delegation, remote files, terminal cwd and creating a new remote agent. Unit checks
also prevent a file from being attached to a chat on another host or workspace. Tests never send
tasks to production agents.
It also dispatches through a persistent worker, reconnects that worker, retries the same native
message ID, and verifies one user message plus a saved result after a later independent turn.

The production daemon and desktop app require an upgrade to load the new code. Building this
checkout does not replace or restart the running application.

Locally assembled desktop packages carry `Contents/Resources/local-build.json`. The desktop
updater excludes marked packages from official update checks and installation, including the
quit-time installer. Otherwise an already downloaded upstream release can replace the custom
renderer during an upgrade or a normal quit. Ordinary packages without that marker retain the
official updater. Keep the local marker, ASAR integrity metadata and code signatures together
when assembling an installable desktop package.
