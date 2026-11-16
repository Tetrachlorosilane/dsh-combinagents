# AGENTS.md — dsh-combinagents

Working contract for anyone changing this repository. Read
[`docs/FEASIBILITY.md`](docs/FEASIBILITY.md) before touching runtime code.

## 1. Current status

This is a **scaffold**, not a working plugin. It contains:

- a pure composition graph (`src/graph.js`) with tests;
- an inert bundle entry (`index.js`);
- a bundle patch that loads the inert entry;
- a documented feasibility and architecture proposal.

Do not install it into a profile expecting a composition UI. Do not describe
native re-parenting as implemented.

## 2. Product contract

`dsh-combinagents` builds a **user-owned overlay graph** over DSH agents and
subagents. Each node is backed by an existing DSH session (or is an external
placeholder). A `reports-to` edge is an organizational statement, not a change
to DSH's native lineage.

Hard invariants:

- Never write `SessionHeader.parentSession`, `origin`, `delegationDepth`, or
  `cwd`.
- Never append or rewrite `subagent/catalog`.
- Never call `workingDirectory.set`, `permissionPresets.set`,
  `sandboxPolicy.registerWritableRoot`, or ACL code from a graph mutation.
- Never route messages across native subagent trees in phase 1.
- Never register a model tool or prompt section in phase 1.
- Never delete a DSH session because a graph node was removed.

The graph may be a strict forest only: one incoming `reports-to` edge per node.
Multiple roots are allowed.

## 3. Verified DSH facts (0.2.2-rc.3)

Re-verify these before claiming compatibility with another release.

| Fact | Source |
|---|---|
| `SessionHeader` is immutable; `parentSession` and `origin` are creation metadata | `@deepseek-ai/dsh-session/src/types.ts` |
| `workingDirectory.set` appends a change event; it does not change existing processes or permissions | `ctx.workingDirectory` contract |
| `subagent/catalog` is a parent-owned append-only event | `@deepseek-ai/dsh-subagent/src/catalog.ts` |
| `startActivation` requires an exact live parent and creates a new child | `@deepseek-ai/dsh-subagent/src/index.ts`, `src/manager.ts` |
| `rootOf` needs a live Activation; a `parentSession` header alone is not tree membership | `src/manager.ts`, `rootOf` |
| Cold resume walks `parentSession` plus each parent catalog entry | `src/manager.ts`, `resolveCreationAncestry` |
| `sendMessage` only targets the caller's native tree | `src/index.ts`, `manager.ts`; `@deepseek-ai/dsh-tool-subagent-control/README.md` |
| Child creation inherits the **parent's** sandbox/approval policy; it does not copy a different source's policy | `src/child-agent.ts`, `captureDelegatedPolicyOverrides` |
| External agents have no local Session and accept no follow-up | `@deepseek-ai/dsh-subagent/README.md` |
| Team membership is one native tree and a shared checkout | `@deepseek-ai/dsh-agent-team/README.md` |
| `sessionQuery.listSessions` exposes live and persisted headers without activation | `ctx.sessionQuery` contract |

Consequence: actual re-parenting of existing sessions requires a DSH core
feature, not this plugin.

## 4. File map

```
index.js                  Inert bundle entry; do not add runtime behavior piecemeal
cordis.patch.yml          Bundle patch for the scaffold
src/graph.js              Pure composition graph: validation, forest, cycle checks
tests/graph.test.mjs      Graph unit tests
docs/FEASIBILITY.md       DSH source review, options, verdicts
docs/ARCHITECTURE.md      Phase-1 design, storage, HTTP, UI, acceptance criteria
package.json              ESM package, no dependencies, DSH bundle shape
```

Planned files when phase 1 starts:

```
src/store.js              DSH storage-domain adapter
src/manager.js            Composition manager, serialized mutations
src/discovery.js          Live/persisted session and native-catalog discovery
src/http.js               Same-origin JSON bridge
client.js                 Right-sidebar tab + header button
locale/{en,zh}.json       Plugin Manager metadata
tests/*.test.mjs          Graph, manager, HTTP, UI registration tests
```

## 5. Development rules

### Graph changes

- Keep `src/graph.js` dependency-free and usable from plain Node.
- Every new invariant needs a test in `tests/graph.test.mjs`.
- Mutations are immutable: return a new composition and never mutate the input.
- Reject with `CompositionError` and a stable `code`; do not throw bare strings.
- Keep `validateComposition()` total: it must report malformed records rather
  than crash on them.
- Preserve insertion order for nodes and edges; UI and tests rely on it.

### Host/runtime changes (future)

- Use DSH storage domains, not a private JSON file.
- Serialize mutations per composition. Two UI clicks must not interleave a
  read-modify-write.
- Treat `sessionQuery`, `sandboxPolicy`, `permissionPresets`, `workingDirectory`,
  and `subagents` as optional. A missing service degrades one displayed field;
  it must not take down the whole tab.
- Read policy for display only. Do not cache a live `Session` in durable state.
- Validate a session id against the discovery corpus before attaching it.
- Keep the HTTP bridge same-origin, loopback-only, token-authenticated, and
  body-limited, following the `dsh-extraworkspace` pattern.

### Client changes (future)

- Static `window.__ModuleLoader__.load` factory, module id equal to package name.
- One right-sidebar tab and one guide entry. The header utility opens the tab.
- Use only shared `react`/`react-dom`; do not import Harness Client packages.
- Use `--dsw-alias-*` theme tokens; no literal colors.
- All visible strings in the `dsh-combinagents` locale namespace; keep `en` and
  `zh` complete.
- Label native lineage separately from composition lineage. Never imply that an
  overlay edge changes `send_message` authority.
- Disable actions that require a local session on external nodes.

## 6. Verification

Before handing a change back:

```bash
node --check index.js src/graph.js
node --test tests/*.test.mjs
node -e "for (const f of ['package.json']) JSON.parse(require('fs').readFileSync(f,'utf8'))"
```

When runtime code exists, additionally:

1. Install the bundle with `plugin_manager` (local directory target).
2. Confirm the Host row is active with `cordis_inspect_query`.
3. Confirm the right-sidebar tab occupant and header utility slot.
4. Add a session from a different workspace and one native subagent; verify
   source/native-parent badges.
5. Reparent a node; verify cycle/duplicate rejection and persistence after a
   Host restart.
6. Verify no session header/cwd/policy event was appended by a graph mutation.
7. Check light/dark themes and narrow width.
8. Confirm no new tool appears in the model tool list.

## 7. Known pitfalls

- **`parentSession` is not tree membership.** A session can have a parent header
  and still fail `rootOf` if no live Activation owns it. Never synthesize a tree
  by writing headers.
- **Catalogs are append-only.** There is no public delete-child operation.
  A "removed" native child remains in its parent's catalog for discovery; the
  overlay must not try to hide that history.
- **External agents are not resumable.** Do not offer follow-up or "open
  conversation" as if a local Session existed.
- **Ordinary forks are new roots.** `ctx.sessions.fork()` copies history and
  may retain a source id in `parentSession`, but `origin` is absent; it leads a
  new native tree.
- **Policy is parent-inherited at child creation.** A new child of a new parent
  does not automatically keep a different source session's permission preset.
  If materialization is added, re-applying a policy is a separate, audited
  write.
- **The graph can go stale.** cwd and policy are observations. Re-read on
  `/state`; do not present a snapshot as the session's permanent configuration.
- **Do not use session events for graph state.** Use a storage domain. The graph
  is plugin-owned data, not a session log concern.
- **Client bundles are cached in the page.** Refresh after `client.js` changes
  unless the client HMR watcher is running.

## 8. Commit hygiene

- No personal paths, usernames, tokens, or machine names in the repository.
- Keep commit author generic (`dsh-combinagents <dsh-combinagents@localhost>`)
  when committing on behalf of the project.
- Do not push or publish unless the user asks.
- Update `README.md`, `docs/FEASIBILITY.md`, and `docs/ARCHITECTURE.md` when a
  design decision changes; the docs are part of the contract.
