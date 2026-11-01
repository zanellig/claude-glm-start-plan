# Validation on November 1, 2026

## Claude Code

- Installed command: `~/.local/bin/claude-glm`, linked to this checkout.
- Actual Claude Code executable: version 2.1.314.
- Initial model: GLM-5.3-Flash. The native `/model` picker lists Flash and GLM-5.3 with their Start labels.
- The native TUI was used to select GLM-5.3, change `/effort` to max, and submit `Reply exactly GLM_TUI_OK.`. It returned `GLM_TUI_OK`.
- Both models passed real calls at low, high, and max. Flash passed medium and xhigh after normalization. A Bash tool round trip completed in two turns. [Recorded matrix](evidence/live-smoke.jsonl).
- After the streaming-error normalization was added, another installed-command Flash request returned `FINAL_GLM_OK`.
- The source never starts a ZCode agent in the Claude Code path. The adapter supplies the required built-in ZCode instructions, an exception explicitly accepted by the user after the strict original requirement was found incompatible with the gateway.
- Requests authenticate against the existing desktop account and use only the Start inference endpoint. The authenticated account balance advertised both requested models. The flagship token bucket increased by 21,511 used tokens across the interactive flagship test.

The matrix exercises real upstream requests. The offline tests separately verify exact effort translation, preservation of tool results and Claude instructions, credential reload after rotation, rejection of other models, UTF-8 streaming, provider business errors, client cancellation, and listener/settings-file cleanup.

## ZCode CLI

- `~/.local/bin/zcode` points to this checkout's wrapper.
- Source repository commit `a60ba6a7e5a06742270ca605f5d2cc2766afa7e1` was built locally. The staged CLI reports 0.17.1 and runs with existing Node 24.22.1.
- The staged runtime has no broken symlinks or dependency symlinks outside its directory. It still runs after the source checkout's generated dependency/build directories were removed.
- Interactive TUI startup succeeded on Node 24. Node 26 was rejected by the OpenTUI FFI backend, so the launcher selects Node 24 explicitly.
- A post-cleanup file-read tool round trip returned `ZCODE_FILE_OK` with two model requests. The dedicated session database records provider `zcode-start`, model `GLM-5.3-Flash`, effort variant `max`, and both requests completed. [Recorded smoke result](evidence/zcode-smoke.json).
- The final test session exists in the dedicated CLI database and is absent from the desktop's shared database. Earlier smoke sessions used the shared default before the explicit storage overrides were added; no existing conversations were removed.

## Checks and limits

Eighteen offline tests pass with `node --test`. The real ZCode source build, native dependency provenance, runtime size, and package-age check are documented in [the CLI notes](zcode-cli.md).

The Start gateway and promotional quota are external services. Future authentication expiry, allowance exhaustion, concurrency limits, provider outages, or a changed gateway prompt policy can still reject requests. Those failures are surfaced as errors; there is no paid-provider fallback. This validation does not claim a full security audit, long-context load test, or coverage of every optional Claude Code/ZCode feature.
