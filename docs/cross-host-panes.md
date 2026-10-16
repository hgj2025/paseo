# Cross-host panes

A workspace window can show agents from several paired hosts. Its layout belongs to the
workspace that opened the window. Each scoped tab carries its own `serverId`, `workspaceId`,
and resource target. Moving or reopening a tab retains that binding.

## Using the window

1. Open the host Mac's normal workspace and split its pane right or down.
2. In the new pane, choose **host · workspace**. The picker lists existing workspaces on
   paired hosts. It does not create a directory, copy code, or change an existing agent's cwd.
3. Choose **Open agent** for an existing session, or **Agent** to start one in that workspace.
   Provider discovery, messages, permissions, files, and terminals use that pane's host.
4. On the intended lead agent, choose **Make lead**. On another agent, choose **Link to lead**.
   This sends the lead a visible message identifying the collaborator. It does not dispatch a
   development task until the user asks the lead to do so.

Pane headers show host and workspace names, not a second working-directory form. CLI processes
still need a real cwd. A shared directory can have different paths on the two hosts; no mapping
is inferred from equal workspace names. The Explorer dock continues to represent the window's
workspace; use Files or Changes from a scoped pane's + menu to inspect that pane's workspace.
File attachments only target a chat on the same host and in the same workspace as the file.

Closing a scoped tab closes its view, preserving the remote agent or terminal. Stop an agent
explicitly with its stop control when needed. Layout and lead selection persist on this client;
they are not synchronized to other phones or computers. Remote agent tools run in the lead's
daemon, so an accepted task does not depend on keeping this window open.

## Cross-host agent tools

Same-host agents use the existing `send_agent_prompt` tool. Cross-host dispatch uses three
additional native Paseo MCP tools:

- `list_remote_agents`: with no arguments, lists configured host IDs; with `hostId`, lists that
  host's agents. Executable paths and connection credentials are not included in the response.
- `send_remote_agent_prompt`: requires `hostId`, a full `agentId` UUID, `requestId` UUID and prompt.
  It returns a dispatch receipt, not task completion. Reusing a request ID cannot resend a task.
- `wait_remote_agent`: waits for at most 30 seconds and returns status and recent output. A
  timeout means the task may still be running. Permission requests remain for the user to handle
  in the target pane. There are no automatic completion messages back to the lead in this version;
  the lead obtains results through this bounded wait tool.

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
must support `agent ls --global`, `agent send --no-wait --prompt`, and `agent wait --timeout`.
An authenticated SSH bridge or a Paseo CLI with an explicit `--host` target both work. The
bridge must target one specific daemon and must not fall back to a local daemon when offline.
The supplied Mac mini bridge resolves the VM address through the existing Lume integration.
No new relay or Cloudflare service is required.

Only the daemon-local config selects executables; model input cannot choose a command or endpoint.
Commands use argument arrays, not shell interpolation. Receipts are stored under
`$PASEO_HOME/remote-agent-dispatches` with restrictive file modes. When an acknowledgement is lost,
the receipt stays uncertain: inspect the remote session before issuing a different request ID.
The UI gates coordination on the optional `remoteAgentCoordination` feature; older hosts can still
participate as ordinary remote agent panes.

## Implementation and checks

`workspace-tabs/scope.ts` resolves resource ownership. Pane callbacks wrap follow-up tabs in the
same scope. Panel attributes, dirty-editor retention and close confirmations stay keyed to the
layout owner. Scoped agents are included in the resource host's open-agent observation set,
and only visible scoped panes request streaming history. A disconnected owner does not replace
existing remote panes with a full-window offline gate.

Targeted tests cover scoped identity, persisted ownership, callback routing, safe view-only close,
MCP dispatch deduplication and uncertain acknowledgements. The browser scenario runs two isolated
real daemons with mock model providers and exercises both chat panes, reload, lead registration,
CLI-backed delegation, remote files, terminal cwd and creating a new remote agent. Unit checks
also prevent a file from being attached to a chat on another host or workspace. Tests never send
tasks to production agents.

The production daemon and desktop app require an upgrade to load the new code. Building this
checkout does not replace or restart the running application.

Locally assembled desktop packages carry `Contents/Resources/local-build.json`. The desktop
updater excludes marked packages from official update checks and installation, including the
quit-time installer. Otherwise an already downloaded upstream release can replace the custom
renderer during an upgrade or a normal quit. Ordinary packages without that marker retain the
official updater. Keep the local marker, ASAR integrity metadata and code signatures together
when assembling an installable desktop package.
