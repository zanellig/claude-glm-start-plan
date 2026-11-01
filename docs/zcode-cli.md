# Optional source-built ZCode CLI

This command runs the actual source-built ZCode CLI with the same Start adapter used by `claude-glm`. It is independent of the Claude Code launcher and does not use a desktop AppImage's bundled agent.

## Prerequisites and discovery

You need a Z.ai login in the ZCode desktop application, active Start allowance, and a staged source build. The integration itself needs Node.js 22 or newer. The supported source CLI build additionally needs Node **24** for its OpenTUI FFI implementation.

The launcher uses a compatible current Node executable first, then checks `node24`, `node-24`, and `node` candidates on `PATH`. Set `ZCODE_START_NODE` to select one explicitly. It validates the selected major version; it never assumes NVM, a particular version-manager layout, or a particular patch release.

| Setting | Purpose | Default |
| --- | --- | --- |
| `ZCODE_START_NODE` | Compatible Node executable or command | Discover Node 24 as described above |
| `ZCODE_START_RUNTIME` | Root of the built/staged source runtime | `$XDG_DATA_HOME/zcode-start/runtime` |
| `ZCODE_START_DATA_DIR` | Session storage, database, and ordinary logs | `$XDG_DATA_HOME/zcode-start` |

`XDG_DATA_HOME` defaults to `~/.local/share`. These overrides are local machine configuration. Do not commit resolved executable paths, credentials, or runtime directories to the project.

## Build from a fresh checkout

The supported reference source commit is [`a60ba6a7e5a06742270ca605f5d2cc2766afa7e1`](https://github.com/zai-org/ZCode/commit/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1). Its repository version is 3.17.1, and its agent CLI reports 0.17.1. Source updates require their own compatibility validation.

Select Node 24 and pnpm **10.33.2** for this pinned source. Use your preferred user-local toolchain manager; the integration does not install toolchains automatically. Verify `node --version` and `pnpm --version` in the shell that will run the build.

From the integration checkout, choose an unused source directory:

```sh
glm_project_dir="$PWD"
zcode_source_dir="$HOME/src/zcode-cli-source"
mkdir -p "$zcode_source_dir"
git clone https://github.com/zai-org/ZCode.git "$zcode_source_dir"
git -C "$zcode_source_dir" checkout a60ba6a7e5a06742270ca605f5d2cc2766afa7e1
cd "$zcode_source_dir"
pnpm --filter @zcode/cli... install --frozen-lockfile --ignore-scripts
pnpm --filter @zcode/cli... build
```

Install lifecycle scripts remain disabled; build the CLI workspace explicitly. The dependency tree is large even with this filter. Apply your own dependency and release-age policies. A frozen lockfile preserves dependency versions but does not perform a new release-age resolution.

Return to this integration checkout and stage into a new directory:

```sh
cd "$glm_project_dir"
zcode_runtime_dir="${XDG_DATA_HOME:-$HOME/.local/share}/zcode-start/runtime"
python3 scripts/stage-zcode-runtime.py "$zcode_source_dir" "$zcode_runtime_dir"
node bin/zcode.mjs version
node bin/zcode.mjs
```

The staging helper copies the compiled CLI, TUI, notices, and installed external dependency closure without another package resolution. Its destination must not already exist. It supports the pinned source layout and was exercised on Linux; other source layouts need separate checks.

If staging elsewhere, select it explicitly:

```sh
ZCODE_START_RUNTIME=/path/to/staged-runtime node bin/zcode.mjs version
```

Some npm dependencies include prebuilt native libraries. Building ZCode's JavaScript/TypeScript locally does not rebuild every native dependency or constitute a complete security audit.

## Use from a person or agent session

Run directly from the integration checkout:

```sh
node bin/zcode.mjs --help
node bin/zcode.mjs --cwd /path/to/project --mode plan --prompt 'Explain this project'
node bin/zcode.mjs --cwd /path/to/project
```

Help and version work without account credentials. Model requests require the desktop login. The initial provider is `ZCode Start` with `GLM-5.3-Flash`; use `/model` in the TUI to select a model and its reasoning options.

An optional alias can avoid colliding with an existing `zcode` installation. From the integration checkout:

```sh
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/bin/zcode.mjs" "$HOME/.local/bin/zcode-start"
```

Ensure that directory is on `PATH` and inspect an existing alias before replacing it. Existing installations may retain their `zcode` alias; the wrapper works under either name.

## Integration and state

The supported source CLI's standalone account catalog excludes Start plans. Its newer top-level prompt was also rejected by the Start gateway in the reference check. The wrapper uses its existing personal-provider format, supplying a loopback URL and a local session key. The shared adapter reads the desktop JWT per request and supplies the accepted system blocks. The source CLI's instructions remain in a conversation system message. Upstream tracked source needs no patch.

The provider file is mode `0600` and contains only the local session key. It is removed on exit. The launcher explicitly selects separate session storage, database, and ordinary log paths. The source CLI still uses its standard `~/.zcode/cli` locations for global configuration, plugin definitions, and model-input/output diagnostic recordings. The desktop application's store remains the login source.

Test a staged runtime's TUI and a real tool round trip before deleting build dependencies or replacing a working runtime. Keep runtime artifacts outside this Git checkout. [The reference validation](validation.md) records one build's hashes, package manifests, test results, and retained sizes; those are historical evidence, not required local state.
