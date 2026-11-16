# dsh-combinagents

**Status: installed in the `desktop` profile; Host bridge, shared membership
(including native ancestors), busy guard, native-subagent mirror/sync,
rename/reparent, and client registration verified; GUI visual check pending.**
The Host half provides a durable per-root composition domain, read-only session
discovery (including external/one-shot leaves), serialized graph mutations,
busy-branch protection, and a loopback JSON bridge. A session belongs to one
composition; the tab resolves that shared composition from any member, walking
native ancestors when the member is not mirrored yet. The Client half registers a
right-sidebar tab, a session-header utility, a guide entry, and a separate
composition-count header chip; the shipped subagent tree entry is retained. It
provides node details, rename, reparent, external placeholders, per-edge
message/interrupt grants, open-conversation for every local session (including
persisted ones), and a sync-native action. Three static model tools
(`composition_list_agents`, `composition_send_message`,
`composition_interrupt_agent`) mirror the native control parameters and are
gated by per-edge grants; cross-workspace delivery without full permission asks
the user through the approval service. A plugin-owned task board (`tasks` table)
supports create, start, complete, reopen, and delete with a revision guard; it is
not DSH Team and never writes native Team state. The `mode: 'composed'` config option registers
`list_agents`, `send_message`, `interrupt_agent`, `subagent`, `subagent_fork`,
and `wait_agent` under native names/descriptions/parameter schemas.
`subagent`/`subagent_fork` start a native activation under the caller, mirror
the child into the composition, and auto-grant the delegation edge;
`send_message` prefers the native relay for native descendants (including cold
resume), falling back to live cross-tree delivery. Composed mode is implemented
but not enabled in the desktop profile; a clean headless profile verified the
full chain (start → child edge → wait → follow-up message → wait → interrupt). Native `subagent/start` events are mirrored into the
composition as new nodes without changing any tool schema or routing authority.
Session status distinguishes `live`, `saved`, and the workspace registry's true
`archived` set; the picker lists headers immediately and folds titles lazily so
opening it no longer scans every session log. The headless browser could not
authenticate to the Web GUI (no launch token) and could not reach loopback
without the obscura SSRF allowance, so the rendered tab is not visually verified
yet. Clone, bridge, bud, and native re-parenting are not implemented.

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

- [设计与交接说明（中文）](docs/HANDOFF.md) — **authoritative product brief**
  for the next agent: requirements, design principles, clone/bridge/bud logic,
  cache-friendly rules, and UI compatibility notes.
- [Feasibility analysis](docs/FEASIBILITY.md) — what DSH permits, what it does
  not, and which designs are viable.
- [Architecture proposal](docs/ARCHITECTURE.md) — the recommended overlay
  foundation, storage, UI, and phased plan.
- [AGENTS.md](AGENTS.md) — the working contract for changing this repository.

## What is in the repository

```
index.js                 Host entry: storage, discovery, manager, HTTP bridge
client.js                Right-sidebar tab, header utility, guide entry
src/graph.js             Pure composition graph (forest, cycles, subtree removal)
src/store.js             DSH storage-domain adapter + memory fallback
src/discovery.js         Read-only live/persisted session discovery
src/manager.js           Serialized mutations and root-session protection
src/http.js              Loopback, token-authenticated JSON bridge
src/controls.js          Static composition list/message/interrupt tools
tests/                   Graph, store, manager, HTTP, and client-registration tests
locale/{en,zh}.json      Plugin Manager metadata
icon.svg                 Bundle icon
docs/HANDOFF.md          Product requirements, design logic, cache and UI handoff
docs/FEASIBILITY.md      DSH source review and design options
docs/ARCHITECTURE.md     Architecture, decisions, and implementation plan
cordis.patch.yml         Bundle patch for the Host entry
```

## Development

```bash
node --test tests/*.test.mjs
node --check index.js src/graph.js src/store.js src/discovery.js src/manager.js src/http.js src/controls.js client.js
```

No build step and no runtime dependencies. The graph model is ordinary ESM
JavaScript and is exported as `@dsh-external/dsh-combinagents/graph` for tests and
Host code. The storage adapter uses the graph validator as its record schema so
the bundle needs no `zod` installation; re-verify that assumption when the DSH
storage contract changes.

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
