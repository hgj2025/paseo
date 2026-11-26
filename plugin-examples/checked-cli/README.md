# Checked CLI

Opt-in Paseo directory plugin plus a standalone agent-side CLI/library.
No Paseo core edits, built-in registry entry, daemon-side command execution, or automatic retries.

## Architecture and boundaries

- `index.server.ts` registers only an `agent.create` hook and host-scoped settings.
  It appends helper instructions to a new agent's existing system prompt.
- The plugin does not register an execution RPC, MCP server or provider.
  It does not change cwd, model, tools, approval settings, sandbox or PATH.
- `paseo-checked-cli` runs through the agent's normal shell tool, under that tool's permissions.
  It is a helper, not an authorization boundary or a sandbox.
  Do not broadly preapprove the wrapper: a request can name any executable; each invocation
  still needs the native tool's applicable authorization.
- `server/runtime.ts` captures one process using argv, no shell interpolation, bounded
  stdout/stderr, a timeout and cancellation. No subprocess stdin is forwarded.
- `server/validation.ts` parses and validates the capture independently of execution.
  Optional and nullable are separate. No implicit coercion or missing-field defaults.
- First release targets macOS/Linux daemon hosts with Node >=20. Phone clients need no changes.
- The compiled CLI bundles its runtime dependencies; a consumer need not install Python,
  TypeScript or Zod. SDK/runtime source imports stay inside this package.

## Build and verify

Inside the Paseo checkout with its dependencies installed:

```sh
cd plugin-examples/checked-cli
npm run typecheck
npm test
npm run lint
npm run build
npm pack --pack-destination /tmp
```

This is a standalone package, not a built-in or a root-workspace member.
When copied out of the checkout, install the declared devDependencies for development.
The package is private to prevent accidental publishing; remove private only for an intentional release.

## Install (explicit opt-in)

Build first. On each daemon host where the helper is wanted:

```sh
npm install --global /absolute/path/to/checked-cli
paseo-checked-cli --help
paseo plugin install /absolute/path/to/checked-cli
```

Check the host's existing `pluginsEnabled` setting before enabling installed plugins.
Paseo plugins are trusted, unsandboxed code. This plugin deliberately executes no commands
in its server process. Do not enable all installed plugins merely to test this one.
Use an isolated test daemon if other configured plugins should remain disabled.

Directory installation alone does not put the helper executable in PATH. If global npm bins
are unavailable, the plugin's `integration` settings accept
`runnerCommand: ["/resolved/node", "/absolute/path/to/checked-cli/dist/cli.mjs"]`.
These values are host-local configuration, not hardcoded in the implementation.
The default is `["paseo-checked-cli"]`.

This version has no client settings screen. For an authorized daemon client, the registered
settings RPCs are `settings.integration.read` (input `{}`) and
`settings.integration.write` (input `{revision, values}`). Use the read result only when it
validates as a ready state, and pass its exact revision when writing. Values contain `enabled`
and `runnerCommand`. Validate the write result as saved; preserve and report conflicts.
Do not edit the plugin settings file by hand. Default PATH installation needs no settings write.

Changing settings affects instructions on subsequent agent creation. Existing agents are not
restarted or rewritten. Removing/disabling the plugin removes its future hook, not historical
instructions already stored in an agent; those agents may still use the independently installed CLI.
To fully remove the helper, uninstall the npm package separately.

## Run once

Put an explicit request into a file (or use `--request -` for a <=64 KiB JSON document on stdin):

```json
{
  "command": "node",
  "args": ["-e", "console.log(JSON.stringify({success:true,items:[]}))"],
  "assertions": [{ "pointer": "/success", "equals": true }],
  "checks": [{ "pointer": "/items", "type": "array" }],
  "select": ["/items"],
  "timeoutMs": 30000
}
```

Replace example coordinates with verified task inputs. Then, through the native shell tool:

```sh
paseo-checked-cli run --request request.json
```

Success: `{"ok":true,"execution":"exited","exitCode":0,"durationMs":12,"data":{...}}`.
Failure has `stage`, `code`, `execution`, `exitCode`, `message` and optionally `pointer`.
Exit status: 0 successful validation; 1 execution/validation/receipt failure; 2 invalid input.
Failures omit raw stdout/stderr by default, rather than echoing possible credentials.
The library returns capture and outcome separately for callers that manage the raw result themselves.

`execution: "exited"` does NOT mean that a business operation succeeded.
`execution: "uncertain"` (timeout/cancellation/output limit) does NOT mean it was rolled back.
An exit-nonzero process can also have partial side effects. Read back native operation receipts
before considering a new invocation. This helper never invokes an automatic retry.

## Reparse without rerunning

Raw retention is opt-in because CLI output can contain credentials:

```sh
paseo-checked-cli run --request request.json --receipt /private/task/result.json
paseo-checked-cli inspect --receipt /private/task/result.json --validation validation.json
```

The parent directory must exist. A receipt path must not exist; reservation happens before
execution. Existing files/symlinks are not overwritten. Files are 0600 and committed atomically.
Receipts contain raw stdout/stderr, execution metadata and no argv/environment.
Keep them in an agent-accessible private location; this package does not automatically delete them.
Do not retain raw credentials where prohibited: reuse the CLI's existing safe operation/session
record instead. No receipt is written unless explicitly requested.

`validation.json` contains only `assertions`, `checks`, `select`.
Inspect never executes a command, including for a failed capture.
A pending or invalid receipt reports uncertain execution, not proof that nothing ran.
Receipt write failure after execution must not trigger replay.

## Validation contracts

The core has no CLI registry, business adapters or response normalization.
The caller supplies a verified contract in request/validation JSON:

- `assertions: [{pointer, equals}]` requires a field to exist and strictly equal a scalar
  (string, finite number, boolean or null). Failure is reported at the business stage.
- `checks` validates field types; `select` projects fields without renaming them.

JSON syntax/type validation alone does not prove business success. Without an explicit
assertion, a body containing `{"ok":false}` remains valid JSON. Never infer a universal
success field or invent a contract from one response. Keep verified request/validation
files with the relevant project's scripts or CLI skill and reuse them with this runtime.
Specialized transformations remain in existing task scripts, outside the core.
The previous development-only `adapter` option is removed and rejected as invalid input.

Checks and selection use JSON Pointer (empty means the root; ~1 slash; ~0 tilde).
They apply to the original JSON document. Assertions run before type checks and selection.
A check accepts type object/array/string/number/boolean, optional and nullable.
Selection returns an object keyed by the supplied pointers. Only owned JSON fields are traversed.

## Coverage and limitations

Tests use real child processes for argv safety, timeout, output limits, launch failure,
and exactly-once receipt revalidation; they also cover JSON/schema/business failures and plugin
configuration isolation. No production CLI, credentials or service mutations are required.
The integration test proves the plugin does not change provider sandbox/MCP settings.
Paseo's actual plugin compiler should also be used when checking a new SDK release.

This is not a universal JSON Schema engine, command policy or replacement harness.
Reliable Python/project scripts remain valid. Existing sessions are not silently opted in.
SIGKILL/crashes cannot guarantee process-tree cleanup or operation rollback.
No hosted service, global configuration change, UI patch or daemon restart is needed to build it.
