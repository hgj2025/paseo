# Claude API credit profile

This optional wrapper extends Paseo's Claude provider with an Anthropic Console API
key and a separate Claude configuration directory. Paseo still uses the official
Claude Agent SDK and Claude Code harness on the daemon host. Model requests go to
`https://api.anthropic.com` and use API billing; a Claude subscription is separate.

## Install on the daemon host

Install Claude Code first. The default executable is `$HOME/.local/bin/claude`.
If it is elsewhere, set `CLAUDE_CREDIT_BINARY` to its absolute path in the provider
`env` below. The wrapper must have a different path from the actual Claude binary.

From the repository root:

```bash
mkdir -p "$HOME/.local/bin"
install -m 700 examples/claude-api-credit/claude-credit "$HOME/.local/bin/claude-credit"
"$HOME/.local/bin/claude-credit" --credit-setup
"$HOME/.local/bin/claude-credit" --credit-status
```

Setup reads the key without echo and atomically saves it with mode `600` in a
mode `700` directory. Obtain the key from the [Anthropic Console](https://platform.claude.com/settings/keys).
Do not put the key in source control, command arguments, or the provider JSON.
Status reports only file presence, not key validity, account balance, or billing.

## Register in Paseo

Merge this entry into `agents.providers` in `$PASEO_HOME/config.json` (default
`~/.paseo/config.json`) on the daemon host. Replace `/absolute/home` with that
user's actual home directory. These JSON paths are literal; do not use `~` or
`$HOME` in them.

```json
{
  "agents": {
    "providers": {
      "claude-credit": {
        "extends": "claude",
        "label": "Claude · API Credit",
        "enabled": true,
        "command": ["/absolute/home/.local/bin/claude-credit"],
        "env": {
          "CLAUDE_CREDIT_HOME": "/absolute/home/.config/claude-api-credit",
          "CLAUDE_CONFIG_DIR": "/absolute/home/.config/claude-api-credit/claude"
        }
      }
    }
  }
}
```

Reload the daemon configuration using your deployment's normal procedure. If a
restart is required, finish active work first. In Paseo, choose the configured
host and **Claude · API Credit** for a new session. Existing subscription sessions
keep their original authentication profile.

## Configuration and troubleshooting

- `CLAUDE_CREDIT_HOME` changes the private profile root. By default it is
  `${XDG_CONFIG_HOME:-$HOME/.config}/claude-api-credit`. Keep `CLAUDE_CONFIG_DIR` in
  the provider JSON aligned with its `claude` subdirectory.
- `CLAUDE_CREDIT_BINARY` changes the Claude executable. It must refer to the real
  Claude Code program, not this wrapper.
- The wrapper clears inherited OAuth tokens and Bedrock/Vertex/Foundry selectors,
  then loads `ANTHROPIC_API_KEY` from the private file. It passes SDK arguments
  through and adds `--print` only when absent. Help and version need no key.
- The wrapper does not configure or remove network proxies. Existing daemon-host
  routing still applies. In the devbox setup, TUN routes traffic through the VPS
  and WARP without explicit HTTP proxy variables; that topology is not required
  by this example.
- Exit `78` means the local key file is missing, unreadable, empty, or has an
  unexpected prefix. Run setup again as the daemon user. A prefix check does not
  establish that the key is valid.
- For authentication diagnosis, request `GET /v1/models` from the daemon host
  using `x-api-key` and `anthropic-version: 2023-06-01`, without printing the key.
  HTTP `200` validates model-list access, not a generation request or balance.
- `Transport not connected` is a Paseo client/daemon transport failure. It does
  not by itself establish an API key or Anthropic connectivity problem.

The private key, Claude login state, and session history remain outside this
repository. This example does not migrate existing sessions between hosts.
