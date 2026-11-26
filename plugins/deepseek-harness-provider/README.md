# DeepSeek Harness provider

Install this daemon-side plugin on the machine that owns your Harness sessions. Paseo clients
use the normal provider picker and Import session dialog; no relay or mobile changes are needed.

Requires the `zstd` executable, `dsh` 0.2.1-rc.5 (tested), and Harness v4 session archives. The plugin launches
`dsh --profile acp` over stdio. It reuses `DSH_HOME`, or `~/.dsh` when unset. Set
`PASEO_DSH_COMMAND` in the daemon environment if `dsh` is not on its PATH. Neither option accepts
shell expressions. `PASEO_DSH_ZSTD_COMMAND` can specify an absolute zstd executable path.
The external decoder avoids Node 24.15 truncating concatenated zstd frames. Credentials remain owned by Harness; the plugin does not read credential files.

```sh
paseo plugin install /absolute/path/to/deepseek-harness-provider
```

Enable external plugins in the host's Plugins settings if they are disabled. Directory installation
uses Paseo's plugin lifecycle; restarting the daemon is unnecessary.

The bridge preserves the original session ID and working directory. It translates Paseo's ACP
`session/load` into native `session/resume` and replays user/assistant text, reasoning and tool
records from `session.v4.jsonl.zstd`. It never copies history into a new Harness session. Archives
are read only, with bounded decompression and directory-containment checks. Corrupt or unsupported
archives fail restoration before the native session is opened. Discovery keeps such rows visible
so loading can report their specific error.

A session occupied by Harness Desktop is not forcibly taken over: release it there before resuming
it in Paseo. An existing shell/browser process is not restored. Plan/todo/custom Harness cards,
attachments and interactive forms are not reconstructed; the initial version replays text and tool
records. Use Desktop for those surfaces. Native approvals, cancellation, configuration and live
updates remain on the ACP transport; the bridge never auto-approves or sends a test prompt.

Model choices are exposed after a real session opens. Catalog refreshes do not create temporary
Harness sessions. The native ACP profile owns model choices, tools and permissions. It is a separate profile from
Desktop, so their plugins/presets can differ even when the session store is shared. Do not run two
writers for one session. Unsupported archive versions require an adapter update, not a fallback to
an empty conversation.
