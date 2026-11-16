# dsh-combinagents

**Status: architecture scaffold.** This repository currently contains the
project contract, a pure composition-graph model, and the feasibility analysis
for DSH `0.2.2-rc.3`. It does not yet provide a runtime composition service or
a Web UI. The bundle entry is intentionally inert; do not install it expecting
behavior.

`dsh-combinagents` is an exploration for DSH (DeepSeek Harness): let a user
arrange multiple **agents** and **subagents**, possibly from different sources
(spawn, fork, ACP, and top-level sessions), into a separate reporting
composition while each session keeps its own working directory, sandbox mode,
approval policy, and tool composition.

The important distinction is:

- **Native subagent lineage** is DSH-owned and immutable at session creation.
- **This plugin's composition** is a user-owned overlay that can be edited at
  any time.

The overlay never rewrites a DSH session header, DSH catalog, sandbox policy, or
permission preset. That is what makes preserving each agent's workspace and
permissions possible.

## Read this first

- [Feasibility analysis](docs/FEASIBILITY.md) — what DSH permits, what it does
  not, and which designs are viable.
- [Architecture proposal](docs/ARCHITECTURE.md) — the recommended overlay
  model, storage, UI, and phased plan.
- [AGENTS.md](AGENTS.md) — the working contract for changing this repository.

## What is in the scaffold

```
index.js                 Inert bundle entry (no runtime behavior yet)
src/graph.js             Pure, durable composition graph model
tests/graph.test.mjs     Graph invariants: forest, cycles, duplicates, removal
docs/FEASIBILITY.md      DSH source review and design options
docs/ARCHITECTURE.md     Recommended architecture and implementation plan
cordis.patch.yml         Bundle patch for the scaffold entry
```

## Development

```bash
node --test tests/*.test.mjs
node --check index.js src/graph.js
```

No build step and no dependencies. The graph model is ordinary ESM JavaScript
and is exported as `@dsh-external/dsh-combinagents/graph` for tests and future
Host code.

## Non-goals

- Replacing DSH's subagent runtime, routing, capacity, or authority checks.
- Merging sessions or moving an existing session to another workspace.
- Widening a session's sandbox or approval policy.
- Cross-host or multi-user composition. This is a local-profile feature.
- A new model-facing tool surface in phase 1.

## Compatibility

Verified against DSH `0.2.2-rc.3` on Windows Desktop. DSH subagent contracts are
release-sensitive; re-read the sources listed in the feasibility analysis
before claiming compatibility with another release.

## License

MIT.
