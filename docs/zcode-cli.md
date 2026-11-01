# Source-built ZCode CLI

The installed `zcode` command runs a locally built ZCode CLI with the same Start adapter as `claude-glm`. It does not execute the downloaded AppImage or its bundled agent.

```sh
zcode
zcode --prompt 'Explain this project' --mode plan
zcode --cwd /path/to/project
```

The initial model is `GLM-5.3-Flash`, under the custom provider named `ZCode Start`. Use `/model` in the TUI to change the model or its reasoning options. Only the signed-in account's active Start allowance is available through this provider. Sign in or renew the account through the desktop application's usual flow when needed.

The source CLI reports version **0.17.1**. The containing desktop/source repository reports **3.17.1**; these are separate version numbers.

## Build and provenance

- Repository: [zai-org/ZCode](https://github.com/zai-org/ZCode).
- Pinned commit: [`a60ba6a7e5a06742270ca605f5d2cc2766afa7e1`](https://github.com/zai-org/ZCode/commit/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1).
- Source checkout: `~/src/zcode-cli-source`. The tracked source has no local modifications.
- Package manager: pnpm **10.33.2**, matching the repository, with a frozen lockfile and install lifecycle scripts disabled.
- Runtime: `~/.local/share/zcode-start/runtime`, about **147 MB**, including the compiled CLI, TUI, license notices, and required external packages. It has no dependency symlinks outside this directory.
- Node for the ZCode process: existing `~/.nvm/versions/node/v24.22.1/bin/node`. Node 26 fails this TUI's FFI implementation with `Node FFI backend does not support usize`; Node 24 starts it successfully.
- SHA-256 of the compiled CLI: `2e4e7743111a79463440aacd1ba8c5df03a30608b977cb91ba2da048adc3e29f`.

The staged bundle was compared byte-for-byte with the output in the source checkout before the build directories were removed. The [build manifest](evidence/zcode-build.json) lists the retained package manifests. This is a source build of ZCode's JavaScript/TypeScript code. Some locked npm dependencies include prebuilt native libraries; they were not rebuilt from their native sources. This was a scoped provenance and startup review, not a complete security audit of the repository or its dependencies.

The source's root `prepare` hook would run Husky and a CUA build. Install lifecycle scripts were disabled instead. The CLI and its workspace dependencies were built explicitly; Electron was not built. Your seven-day package release-age setting was used during the dependency work. A frozen lockfile bypasses fresh version resolution, so the retained external package versions were checked separately against registry publication times afterward. The [age check](evidence/zcode-runtime-age.json) records the results; the `KoffiConfig` descriptor is an embedded build configuration, not a separately published npm package.

The original build tree reached about 4 GB. Its generated dependency directories and build outputs were removed after staging. The remaining source checkout is about 321 MB and is not needed to run the installed command. Shared package-manager caches were not indiscriminately pruned.

## Why the wrapper is needed

The source's standalone account-provider implementation accepts individual Coding Plans and excludes Start plans. A plain source CLI therefore does not expose this signed-in Start account. In addition, the Start gateway rejected the newer source CLI's top-level prompt with code 3012 during the live test.

The launcher uses the CLI's existing personal-provider configuration format. It gives the CLI a loopback URL and an ephemeral local session key, with Flash as its default. The adapter reads the desktop JWT on each upstream request and supplies the accepted built-in system blocks. The source CLI's own instructions remain in the conversation as a system message. This requires no patch to ZCode's tracked source.

```text
zcode launcher
  source-built CLI on Node 24
    temporary personal provider, local key only
      session adapter
        current desktop JWT
        Start allowance endpoint
```

The temporary provider file is mode `0600` and is removed on exit. It never contains the desktop JWT. Session storage, the session database, and ordinary diagnostic logs live under `~/.local/share/zcode-start/.zcode`. The wrapper sets the source's separate storage and database environment variables explicitly. The source CLI still uses its standard `~/.zcode/cli` locations for global user configuration, plugin definitions, and model-input/output diagnostic recordings. Its login source remains the desktop application's credential store.

The initial CLI smoke tests used the source's default shared session database before these storage overrides were added. They left test conversations there; existing conversations were not removed or restored. The final wrapper was verified against its dedicated database after the correction.

Overrides: `ZCODE_START_NODE` selects a compatible Node executable, `ZCODE_START_RUNTIME` selects the staged runtime directory, and `ZCODE_START_DATA_DIR` selects the separate CLI state directory.

## Rebuild

Use the pinned source and the pinned pnpm version. Install only the CLI dependency workspace with scripts disabled, then build the CLI dependency workspace explicitly. The dependency graph is still large even with this filter.

```sh
git clone https://github.com/zai-org/ZCode.git ~/src/zcode-cli-source
cd ~/src/zcode-cli-source
git checkout a60ba6a7e5a06742270ca605f5d2cc2766afa7e1
# Using pnpm 10.33.2 and Node 24:
pnpm --filter @zcode/cli... install --frozen-lockfile --ignore-scripts
pnpm --filter @zcode/cli... build
```

Run the staging helper from this integration checkout, with a new destination:

```sh
python3 scripts/stage-zcode-runtime.py ~/src/zcode-cli-source ~/.local/share/zcode-start/runtime-new
ZCODE_START_RUNTIME=~/.local/share/zcode-start/runtime-new zcode version
```

Test the TUI and a real tool round trip with the new runtime before replacing the active one. The staging helper follows the already-installed package closure and does not perform another package resolution. No system-wide package installation is needed.
