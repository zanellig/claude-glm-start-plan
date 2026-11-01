# GLM Start allowance in Claude Code

Use GLM-5.3-Flash or GLM-5.3 in Claude Code with the Start allowance of the Z.ai account signed in to ZCode. The optional source-built ZCode CLI uses the same adapter.

## Start from a fresh checkout

You need:

- Node.js 22 or newer to run this integration.
- Claude Code 2.1.242 or newer on `PATH`, or selected with `CLAUDE_GLM_CLAUDE`. This is the documented minimum for the required [model-picker feature](https://code.claude.com/docs/en/settings-reference#modelpicker); the reference live run used 2.1.314.
- A Z.ai account signed in to ZCode with an active Start allowance for the model you select.

There are no npm dependencies for the adapter or Claude Code launcher. From this checkout:

```sh
node --test
node bin/claude-glm.mjs --help
node bin/claude-glm.mjs
```

Help and version commands work before signing in and do not create a session profile. A model request requires the ZCode login. Open `/model` to select either model and `/effort` to change reasoning. Flash is the initial model.

An agent can invoke the checkout directly without installing command links:

```sh
node bin/claude-glm.mjs -p 'Explain this project' --output-format json
node bin/claude-glm.mjs --model GLM-5.3 --effort max
node bin/claude-glm.mjs --resume
```

Use this launcher when resuming its sessions. An ordinary `claude` command uses its ordinary profile.

For an optional command link on Linux or macOS, run the following from the checkout. Inspect any existing command before replacing it, and ensure the chosen bin directory is on `PATH`.

```sh
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/bin/claude-glm.mjs" "$HOME/.local/bin/claude-glm"
```

The checkout must remain at its installed location. The [source CLI guide](docs/zcode-cli.md) covers building and running the optional ZCode command. It is not required for Claude Code.

## Instructions and tool execution

Claude Code owns tool execution, permissions, hooks, and session handling. The adapter does not start a ZCode agent in this path.

The Start gateway requires ZCode system instructions. The adapter includes two built-in ZCode blocks and preserves Claude Code's original instructions as a system message inside the conversation. Both instruction sets therefore reach the model. A Claude-instructions-only request is not supported by this integration.

## Reasoning

The provider supports three effort values. Claude Code displays five:

| Claude Code selection | GLM request |
| --------------------- | ----------- |
| low                   | low         |
| medium                | high        |
| high                  | high        |
| xhigh                 | max         |
| max                   | max         |

GLM thinking stays enabled. Claude Code's thinking-off toggle maps to low effort. There is no separate disabled-reasoning mode in the published GLM-5.3 configuration.

The launcher declares a 1,000,000-token window for both models and keeps automatic compaction enabled. Large-context behavior has not been load-tested. Claude Code's dollar estimates do not measure the Start token buckets; use ZCode to check the account's real allowance and expiry.

## Local configuration

Runtime discovery lives in `src/runtime.mjs`. Overrides select a command on `PATH` or an executable path, not a shell command with arguments. Paths support `~` and resolve relative to the invocation's working directory.

| Setting                   | Purpose                                               | Default                                    |
| ------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| `CLAUDE_GLM_CLAUDE`       | Claude Code executable                                | `claude` on `PATH`                         |
| `CLAUDE_GLM_PROFILE`      | Dedicated profile for these sessions                  | `$XDG_CONFIG_HOME/claude-glm/claude`       |
| `CLAUDE_CONFIG_DIR`       | Ordinary Claude profile to seed from                  | `~/.claude`                                |
| `ZCODE_DATA_BASE_DIR`     | ZCode account data root                               | ZCode's existing home-directory convention |
| `ZCODE_CREDENTIAL_SECRET` | Existing ZCode credential-store secret, if configured | ZCode's existing local key derivation      |

When unset, `XDG_CONFIG_HOME` defaults to `~/.config` and `XDG_DATA_HOME` defaults to `~/.local/share`. The source CLI's additional overrides are documented in its guide. No paths from the original author's machine are needed.

The dedicated profile copies the selected ordinary profile's settings once. Existing instruction, hook, skill, agent, and plugin definitions are shared through links. Conversations, preferences, and memories stay in the dedicated profile. Later changes to the ordinary settings file are not copied automatically.

The adapter reads the current `zcodejwttoken` from the existing ZCode credential store on every model request. It never copies or rewrites that login. Inference goes only to `https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages`; there is no paid-plan fallback.

Each session owns an ephemeral loopback listener with a random local credential. A private temporary settings file contains only that local credential. Normal exit and SIGTERM remove it and close the listener. SIGKILL can leave a small temporary directory, whose credential stops working when its listener exits.

Removing an installed command link does not sign out of ZCode. Back up the dedicated profile before removing it if its conversations matter.

## Verification and compatibility

For development, run `npm ci` to install the pinned Biome dev dependency and
activate this checkout's Git hooks. The pre-commit hook checks linting, formatting,
and import organization on staged files. Files under `test/` are excluded from
all Biome commands. The integration still has no runtime npm dependencies.

```sh
npm run check
npm run lint
npm run format
```

If a commit fails its Biome check, fix the reported issues, use `npm run format`
for formatting changes, and stage the changes before committing again. The hook
checks the working-tree contents of staged paths and does not modify or stage files.

```sh
node --test
node scripts/smoke-live.mjs --live --tools
```

Offline tests cover synthetic user directories, executable discovery, custom profiles, incompatible runtimes, protocol translation, and lifecycle cleanup. Live checks explicitly consume the caller's Start allowance. They check both models at low/high/max, the additional effort mappings, and a Bash tool round trip.

Linux has been verified with the real clients. The code derives paths from the caller's environment, but macOS and Windows have not received equivalent live validation. The command-link and source-build instructions use a POSIX shell.

The bundled ZCode 3.16.3 instruction text and request-version headers are protocol compatibility pins. They are deliberately independent of the desktop version installed on a new user's machine. A gateway change needs a reproduced compatibility check before changing them. The source CLI's build commit is likewise a reproducible compatibility target, not an assumed local installation.

[The dated reference validation](docs/validation.md) contains results and screenshots from one installation. Files under `docs/evidence/` are reference artifacts; runtime discovery never reads them as local configuration.

## Modules

```text
bin/claude-glm.mjs
  launcher.mjs      Claude process and session lifecycle
    runtime.mjs    executable discovery and local paths
    profile.mjs    dedicated profile initialization
    proxy.mjs      local authentication and Start response streaming
      credentials.mjs  current desktop login
      protocol.mjs     instruction/tool preservation and effort mapping
        zcode-prompt.mjs  required compatibility blocks
```

References: [ZCode source](https://github.com/zai-org/ZCode), [Start account authentication](https://github.com/zai-org/ZCode/blob/main/packages/services/src/model-provider/accountProviderRequestAuthService.ts), [Claude Code model picker settings](https://code.claude.com/docs/en/settings-reference#modelpicker), and [custom context windows](https://code.claude.com/docs/en/model-config#correct-the-window-for-a-gateway-or-custom-model-id).
