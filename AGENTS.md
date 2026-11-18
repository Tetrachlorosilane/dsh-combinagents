# AGENTS.md — dsh-combinagents

Working contract for anyone changing this repository. Read
[`docs/HANDOFF.md`](docs/HANDOFF.md) for the authoritative product requirements
and [`docs/FEASIBILITY.md`](docs/FEASIBILITY.md) before touching runtime code.

## 1. Current status

Phase 1 **walking skeleton** is implemented in this checkout:

- Host: durable per-root composition domain (`src/store.js`), read-only
  discovery (`src/discovery.js`), serialized mutations (`src/manager.js`), and a
  loopback token bridge (`src/http.js`), wired by `index.js`;
- Client: one right-sidebar tab, a session-header utility, a guide entry, and a
  separate count chip (`client.js`), with complete `en`/`zh` copy;
- Graph: `src/graph.js` with 19 tests, plus store, manager, discovery, HTTP,
  client-registration, host-wiring, controls, bundle-shape, and perf-cache tests (146 total);
- Bundle metadata: `locale/{en,zh}.json` and `icon.svg`.

Installed in the `desktop` profile on 2026-11-16 (`application: applied`) and
visually verified on 2026-11-17. Live checks: the tab body, header utility, and
separate `dsh-combinagents-count` header chip are active slot occupants; the
shipped `subagent-catalog` entry is retained; the bridge returned 200 for
bootstrap/create/add/state/add-external/rename/set-parent/summary/sync-native and
403 for `ROOT_PROTECTED`; `state?sessionId=` and the `rootSessionId=` fallback
resolve the shared composition from a member session, including a native
descendant that has not been mirrored yet; a child edited under a running branch
returned 409 `AGENT_BUSY`; a started subagent was mirrored into the composition
with `source: subagent` and its native parent; observations use the workspace
registry's archive set and metadata live flags, so a non-live session reads
`saved` and only a truly archived one reads `archived`; the picker lists
headers without folding titles (`/sessions` ~0.1 s cold, ~3 ms cached) and loads
titles lazily through `/titles`; observations include cwd, sandbox mode,
permission preset, agent preset, and native parent; the domain wrote
`$DSH_HOME/storages/combinagents/compositions/<rootSessionId>.json` and audit
rows under `storages/combinagents/audit`. The model tool surface is merged into
the standard profile: one `tools/execute` interceptor replaces the execution
path for six native names (`list_agents`, `send_message`, `interrupt_agent`,
`subagent`, `subagent_fork`, `wait_agent`) by returning a canonical value for
the existing native definition. The native name, description, parameter/output
schemas, presentation callbacks, prompt identity/guidance, concurrency
metadata, timeout, and restrictions remain untouched. The native delegation
plugins remain mounted; do not use a preset that removes them. Disabling the
plugin removes the listener and restores the native executor. The old
`composition_*` aliases are removed; `composition_task` is the only globally
registered extra tool. A legacy composed profile with no native rows gets
static fallback definitions until it migrates. Cross-profile coherence uses a
`.revision` marker beside the domain: after every durable composition/policy
write the writer publishes a token, readers reopen the domain when
the token changes, and manager membership is rebuilt from the new generation.
Composition mutations also take a process-shared `.mutation.lock`; the UI polls
`/state` and `/summary` while visible so another profile's edit converges
without a Host restart. Nodes carry the native lifecycle `mode`
(`continuable`/`one-shot`/`external`/`unknown`). `list_agents` omits one-shot and
external rows and includes `mode=` in the remaining descriptions;
`send_message` rejects one-shot follow-ups. The tab checkbox shows one-shot
agents only when enabled and defaults off.
Cross-tree `send_message` / `interrupt_agent` use per-edge grants and the
approval gate; same-native-tree delivery prefers the native relay, and live
cross-tree targets use the composition relay. `subagent` / `subagent_fork`
start a native activation under the caller, mirror the child into the
composition, label it with its native name, auto-grant the delegation edge, and
forward the native `agent_preset` field when the schema exposes it. Explicit
child `provider`/`model`/`reasoning_effort` selection is validated through the
live LLM route and forwarded as child agent options. `composition_task` lists,
creates, and updates board tasks (never DSH Team). The native
`list_subagent_models` and other unique tools are untouched. The native prompt
sections stay in place; the plugin adds no duplicate identity/delegation prompt.
A clean headless profile verified the full chain in the earlier composed
surface, and the interception/fallback behavior is covered by host/controls tests.
The real GUI
was visually verified on 2026-11-17 in dark and light themes and at 420 px
width: both header entries open the tab, the count chip
coexists with the shipped
`subagent-catalog` entry, the picker filters and adds/removes sessions, details
show cwd/sandbox/preset/native parent, rename/reparent and per-edge grants work,
external placeholders render collapsed, the task board transitions, sync-native
is callable, and composition create/delete leaves DSH sessions untouched.
Clone and bud execution is implemented: `src/clone.js` is the pure planner
(whole-root tree selection, clone markers, task-copy owner mapping) and
`src/clone-manager.js` is the host adapter (seeded root, depth-first native
children, idle children, task copy, workspace attach, failure cleanup);
`/clone-tree` and `/bud` are the product routes. Live verification on
2026-11-18 cloned a two-node tree and a larger multi-agent team: the clone root
appears in the source workspace, 15 children are cataloged and saved, the clone
root stays idle (no new turn), the source composition is unchanged, and the
copied task owner is remapped. The GUI shows the clone badge/details and the
task board. The temporary `/clone-spike` route was removed. The findings are in
[`docs/CLONE-SPIKE.md`](docs/CLONE-SPIKE.md).
The cross-tree delivery capability described
as the Bridge is implemented as the composition control tools (per-edge grants,
approval gate, audit), not as a separate layer. Do not describe native
re-parenting as implemented. The 2026-11-18 audit hardened the bridge with
exact loopback `Host`/same-origin `Origin` checks (including `/bootstrap`),
cross-composition membership guards in `sync-native`/`auto-attach`, locked and
compensated `moveAcross`, task `createdBy`/actor enforcement, corpus/native
caches, and a bounded release policy for retained clone roots.

## 2. Product contract

`dsh-combinagents` builds a **user-owned overlay graph** over DSH agents and
subagents. Each node is backed by an existing DSH session (or is an external
placeholder). A `reports-to` edge is an organizational statement, not a change
to DSH's native lineage.

The product is broader than the overlay alone: the design handoff adds
**snapshot/clone** (branch a team, bud a subagent as a new root) and a
**controlled bridge** (explicitly authorized cross-tree messages). Clones are
new Sessions, never native re-parenting.

Hard invariants:

- Never write `SessionHeader.parentSession`, `origin`, `delegationDepth`, or
  `cwd`.
- Never append or rewrite `subagent/catalog`.
- Never call `workingDirectory.set`, `permissionPresets.set`,
  `sandboxPolicy.registerWritableRoot`, or ACL code from a graph mutation.
- Cross-tree delivery uses the composition-aware same-name `send_message` /
  `interrupt_agent` execution interceptors, gated by per-edge grants and the
  approval rule below. Do not bypass them with an unshadowed native tool.
- Do not add prompt sections or dynamic tool descriptions. Composition control
  and delegation tools are static; native tool schemas stay unchanged.
- Never delete a DSH session because a graph node was removed.
- **Cache-friendly by default:** do not change system prompt, tool schema, model
  route, cwd, preset, or permission policy unless explicitly required and
  documented. Append notices after history; never prepend them.

The graph may be a strict forest only: one incoming `reports-to` edge per node.
Multiple roots are allowed.

One session belongs to **at most one composition**. The tab resolves that shared
composition from any member session, so all members see the same configuration.
Structural edits (add, remove, reparent) are blocked while an affected agent,
one of its composition ancestors, or one of its composition descendants is
running; a collateral branch stays editable. Adding an existing session moves
its composition subtree; adding a session from another composition moves that
subtree into the target; selecting the source root moves that tree, and a
remaining source forest is re-keyed to another local root. Native `subagent/start` events are
mirrored into the owning composition as new nodes/edges, without changing any
tool schema or routing authority.

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
index.js                  Host entry: store, discovery, manager, HTTP bridge
client.js                 Right-sidebar tab, header utility, guide entry,
                          count chip
cordis.patch.yml          Bundle patch for the Host entry
src/graph.js              Pure composition graph: validation, forest, cycle checks,
                          promote/cascade removal
src/clone.js              Pure clone/bud planner: whole-root tree, markers,
                          task-copy owner mapping
src/clone-manager.js      Whole-tree clone/bud adapter: seeded root, depth-first
                          children, idle children, task copy, failure cleanup
src/store.js              DSH storage-domain adapter + memory fallback,
                          revision reload, cross-profile mutation lock
                          (compositions/policies/audit/audit_archive/tasks/clones)
src/discovery.js          Live/persisted session discovery and observations
src/manager.js            Serialized mutations, grants, path authorization
src/http.js               Loopback, token-authenticated JSON bridge
src/controls.js           Execution interception (6) + composition_task
tests/graph.test.mjs      Graph tests (19)
tests/clone.test.mjs      Clone/bud plan tests
tests/clone-manager.test.mjs  Clone/bud adapter tests
tests/store.test.mjs      Domain adapter, fallback, record schema
tests/manager.test.mjs    Creation, serialization, root protection
tests/discovery.test.mjs  Read-only discovery and observations
tests/http.test.mjs       Token, routes, error mapping
tests/client.test.mjs     Client registration and locale parity
tests/controls.test.mjs   Execution interception, relay, approval, interrupt, delegation/wait
tests/host.test.mjs       Host wiring and bridge registration
tests/bundle.test.mjs     Manifest, patch, and referenced-file shape
tests/perf.test.mjs       Summary/state cache and route budget regressions
locale/{en,zh}.json       Plugin Manager metadata
icon.svg                  Bundle icon
docs/HANDOFF.md           Authoritative product requirements, clone/bridge/bud logic,
                          cache rules, original-project UI and compatibility notes
docs/FEASIBILITY.md       DSH source review, options, verdicts
docs/ARCHITECTURE.md      Phase-1 design, storage, HTTP, UI, acceptance criteria
docs/COMPOSED-PROFILE.md  Standard-mode execution interception and migration
docs/CLONE-SPIKE.md       DSH seed/catalog/permission findings for clone/bud
package.json              ESM package, no runtime dependencies, DSH bundle shape
```

Remaining work: verify the execution interception, the six native definitions,
and native-path restoration in a live standard session; compare tool order and
the prefix fingerprint with the native request; keep large-session tab latency
under observation. The legacy composed preset is no longer the default; do not
use it for new sessions because it removes the native definitions the interceptor
relies on.
Clone/bud live verification and the temporary `/clone-spike` removal are
complete (2026-11-18). The 2026-11-18 audit fixed P0 SEC-1 (Host/Origin), SEC-2
(one-composition membership), SEC-4 (locked/compensated move), plus P1 SEC-3
(task provenance), PERF-1/2/3/4/5/6/7/8/9/10/11 (native/corpus/title caches,
composition-only summary, title/clone bounds, lock splitting, record reuse, no
implicit sync, task/clone indexes, audit pruning, picker cap). R-1/R-4/R-5 are
also fixed. A second-round hardening on 2026-11-18 fixed the `res.on('close')`
cancellation bug (clone/bud no longer get an already-aborted signal), task-index
ghost rows after a root move, DSH model-selection-policy enforcement in composed
`subagent`, `wait_agent` reported-input de-duplication and unload lifetime,
`isConcurrencySafe` for `subagent`/`subagent_fork`/`list_agents`, running-clone
eviction protection, truthful cached native counts in `/summary`, early
Host/Origin/token and oversized-body rejection in the Node adapter, audit
rotation to an `audit_archive` table, same-cwd sandbox/permission/approval
comparison for cross-workspace messages, native-relay error propagation,
relay-label sanitization, workspace detach on failed clone, moving the
`autoAttach` title retry outside the root lock, and a picker truncation hint.
Remaining audit items: SEC-6 (default bidirectional grant, product decision),
SEC-8 rate limiting, SEC-11 (loopback/proxy trust), SEC-12 (clone permission
drift), X-10 (agent_preset/provider capability), X-12 (storageDomain hard
inject, DSH version pin) and X-14 (cold title / `/state` cold), plus optional
cold-title/seed-streaming improvements. The composed profile now documents the
native `@deepseek-ai/dsh-tool-subagent/model-selection-settings` row; the
installed profile must mount it and opt in before non-parent routes work. Decisions
(2026-11-18): a connection the user adds manually defaults to bidirectional
messaging (`allowMessage: true`, `allowInterrupt: false`); direct reparenting
migrates an existing grant, or defaults the replacement edge to messaging when
there was none; detaching removes the grant; composition title editing is
implemented; archived nodes keep the current "offer open conversation, the
workspace decides" behavior.
Clone/bud decisions: clone the **whole root tree**; copy the plugin-owned task
board and remap owners; expose no cwd/preset/permission override; budding keeps
the original node, never auto-archives it, and leaves two parallel trees.

## 5. Development rules

### Graph changes

- Keep `src/graph.js` dependency-free and usable from plain Node.
- Every new invariant needs a test in `tests/graph.test.mjs`.
- Mutations are immutable: return a new composition and never mutate the input.
- Reject with `CompositionError` and a stable `code`; do not throw bare strings.
- Keep `validateComposition()` total: it must report malformed records rather
  than crash on them.
- Preserve insertion order for nodes and edges; UI and tests rely on it.

### Host/runtime changes

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

### Client changes

- Static `window.__ModuleLoader__.load` factory, module id equal to package name.
- One right-sidebar tab and one guide entry. The header utility opens the tab.
- Use only shared `react`/`react-dom`; do not import Harness Client packages.
- Use `--dsw-alias-*` theme tokens; no literal colors.
- All visible strings in the `dsh-combinagents` locale namespace; keep `en` and
  `zh` complete.
- Label native lineage separately from composition lineage. Never imply that an
  overlay edge changes `send_message` authority.
- Disable actions that require a local session on external nodes.
- Keep the shipped `subagent-catalog` header entry. Add a separate
  `dsh-combinagents-count` chip (order 11) that opens this tab; never reuse the
  native id, because that removes the native subagent tree's view/interaction
  path.
- Offer "open conversation" for every local session node, including persisted
  and archived ones; external nodes stay disabled.

## 6. Verification

Before handing a change back:

```bash
node --check index.js src/graph.js src/clone.js src/store.js src/discovery.js src/manager.js src/http.js src/controls.js client.js
node --test tests/*.test.mjs
node -e "for (const f of ['package.json', 'locale/en.json', 'locale/zh.json']) JSON.parse(require('fs').readFileSync(f,'utf8'))"
```

Installed in the desktop profile. The Host bridge, external-leaf listing,
rename/reparent endpoints, shared membership resolution (including native
ancestors), busy guard, native-subagent mirroring/sync, client slot
registration, and the rendered GUI are verified. Completed on 2026-11-17:

- the scrollable picker and one-line filter; add/remove a session node;
- details (cwd/sandbox/permission preset/agent preset/native parent), rename,
  reparent, per-edge grant toggles;
- direct reparenting carries the edge's grants to the replacement edge
  (`setParent` and same-composition `addNode`), covered by manager tests;
- composition title editing through `/set-title` and the tab header, covered by
  manager/HTTP tests and exercised live after the Host restart;
- direct reparenting grant migration exercised live on a sample composition
  (the edge id changed, `allowMessage`/`allowInterrupt` stayed true/false);
- external placeholder rendering (collapsed, provider/native parent, no open
  conversation); added through `/add-external` because this profile had no
  discovered external leaf to click, with a fake-catalog bridge test covering
  `/external` followed by `/add-external`;
- promote/cascade remove dialog; composition create and delete;
- both header entries open the tab; the count chip coexists with the native
  `subagent-catalog`; the count refreshes after tab mutations;
- sync-native on a 16-node composition;
- dark and light themes and 420 px width (no horizontal overflow; action buttons
  no longer split mid-word).

Still open: live standard-session verification of the execution interception,
the canonical request-prefix fingerprint, and large-session tab paint. The
legacy composed preset remains on disk only for old sessions; new sessions use
`standard`. Clone/bud GUI checks passed on 2026-11-18.


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
- **Cross-profile domain snapshots are per process.** The `.revision` marker and
  `.mutation.lock` sidecars make other Hosts reload and serialize writes; an old
  Host or a custom storage directory without `storageDir` does not participate.
  The UI converges on its 3 s/5 s poll, not synchronously.
- **Manual connections default to messaging.** A user-added or reparented
  connection starts with `allowMessage: true` and `allowInterrupt: false`, so
  either endpoint can message the other without a first toggle. A migrated
  explicit grant (including an explicit deny) is preserved. Detaching removes
  the grant; native-mirrored edges stay at the deny default.
- **A very large session can delay the tab paint.** For a 16-node composition
  under a huge live transcript, the tab can still show its loading state for
  tens of seconds even though a warm `/state` returns in low milliseconds.
  Profile the surrounding session UI before blaming the bridge.
- **Archived nodes still offer "open conversation".** The workspace decides
  whether it can resume; this is an intentional 2026-11-17 decision.

## 8. Commit hygiene

- No personal paths, usernames, tokens, or machine names in the repository.
- Keep commit author generic (`dsh-combinagents <dsh-combinagents@localhost>`)
  when committing on behalf of the project.
- Do not push or publish unless the user asks.
- Update `README.md`, `docs/FEASIBILITY.md`, and `docs/ARCHITECTURE.md` when a
  design decision changes; the docs are part of the contract.
