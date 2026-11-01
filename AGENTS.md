# Architectural decisions

Read [README.md](README.md) for behavior and usage. Before changing the source-built CLI or its packaging, read [docs/zcode-cli.md](docs/zcode-cli.md).

- Keep this repository an integration layer. Client applications own tool execution, permissions, and conversation state; the adapter translates the provider protocol.
- Keep provider compatibility shared between launchers. Put client-specific process, environment, and storage choices in the corresponding launcher. Prefer configuration and adapter changes over patches to upstream ZCode.
- Resolve local executables and directories through `runtime.mjs` using caller configuration and discovery. Keep machine installation state out of tracked code; verify another user layout in tests. Compatibility pins need evidence, not replacement with whichever version happens to be installed locally.
- Preserve instruction text, tool schemas, tool-call identifiers, and message order during translation. Changes to instruction priority, reasoning meaning, or quota selection require explicit user agreement, even when the provider accepts the request.
- Keep the integration runtime on Node's standard library. Upstream build dependencies belong to the separate source build. Adding an integration dependency or maintaining an upstream fork requires revisiting the design.
- Give each new process, listener, or temporary file one lifecycle owner. Verify cleanup on startup failure, cancellation, and exit. Verify actual persistence locations; one upstream directory override does not establish isolation for other stores.
- Treat upstream upgrades as compatibility work. Reproduce the changed behavior before adapting it, add regression coverage at the shared boundary, and repeat the affected live checks. Picker changes need native TUI verification; successful CLI arguments alone do not prove them.
- Keep operational facts in the README and version-specific evidence in `docs/`. Update this file only when an agreed architectural boundary changes.
