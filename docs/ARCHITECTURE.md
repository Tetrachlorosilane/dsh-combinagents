# Architecture proposal

**Status:** Phase 1 walking skeleton is installed in the `desktop` profile. The
Host bridge, durable domain write, root protection, shared membership
resolution, busy-branch guard, native-subagent mirror, and the client slot
occupants are verified; the rendered GUI is not visually verified (the headless
browser lacks the Web auth launch token and obscura blocks loopback by default).

**Scope update:** the authoritative product brief is
[`HANDOFF.md`](HANDOFF.md). It adds two layers beyond this document's overlay
foundation: **snapshot/clone** (branch a team, bud a subagent as a new root) and
a **controlled bridge** (explicitly authorized cross-tree messages). Clones are
new Sessions, never native re-parenting.

**Decision record (2026-11-16, reading A):** storage is one profile-level
`combinagents` domain holding one record per root session; ownership, UI entry,
and lifecycle stay per-root. The root-session node is protected from removal.
Delete is promote-or-cascade for non-root nodes; external agents are discovered
conditionally but stay visible once attached, collapsed by default; the node
detail may open a live local session. See §2, §3, §5.4, §6, §10, §12.

The recommended product starts with an **overlay composition**: a user-owned
reporting graph layered over DSH's immutable native agent lineage. The overlay is
stored by this plugin, never by rewriting a session. Each node keeps the
workspace, sandbox mode, approval policy, and tool composition it already has.

Read [HANDOFF.md](HANDOFF.md) and [FEASIBILITY.md](FEASIBILITY.md) first. In
particular:

- Native re-parenting is not a plugin feature.
- Overlay edges do not change `send_message` authority.
- Phase 1 adds no model-facing tools.
- External/one-shot agents can be visible leaves but cannot receive follow-ups.
- Cache-friendly behavior is a design constraint, not an optimization detail.

## 1. Product boundaries

### In scope for phase 1

- Discover live and persisted DSH sessions.
- Attach a session to a composition as a node.
- Add an external-agent placeholder for a catalog-only child.
- Arrange nodes in a strict `reports-to` forest.
- Rename nodes and detach/reparent them.
- Show each node's source, native parent, workspace, sandbox mode, permission
  preset, and live status as **read-only observations**.
- Persist compositions across Host restarts.
- Edit from one right-sidebar tab with an optional fullscreen presentation.

### Out of scope for phase 1

- Changing `SessionHeader.parentSession`, `origin`, `delegationDepth`, or `cwd`.
- Appending or rewriting `subagent/catalog` events.
- Calling `permissionPresets.set`, `sandboxPolicy.registerWritableRoot`, or
  `workingDirectory.set`.
- Cross-tree `send_message`, `interrupt_agent`, or Team task assignment.
- New model tools, prompt sections, or runtime context.
- Cross-host or multi-user synchronization.
- Merging workspaces or moving a session to another workspace.

## 2. Ownership and scope

Storage is **one profile-level `combinagents` domain**; each record is one
composition, keyed by its **root session** — the session whose right-sidebar tab
was open when the user created it. Ownership is therefore per root for lookup,
UI entry, and lifecycle, while the data lives in the profile's storage domain.
One composition per root session for phase 1. The composition may contain
sessions from other roots and other workspaces; ownership only decides which
tab opens it and which record key it uses. A session belongs to **at most one
composition**: the tab resolves the owning record from any member session, so
all members see and edit the same configuration.

This has three useful properties:

1. The durable key is a real DSH session id, not a synthetic profile-level id.
2. A session can be shown in more than one root's chart without its own state
   being duplicated (one node per session **within** one composition).
3. Archiving the root does not delete the composition; it remains readable when
   the session is resumed.

The record also carries `composition.id`, so a later version can allow multiple
named compositions per root by keying on the composition id plus a per-root
index; that migration does not touch the graph model. A profile-wide composition
independent of any root is not the phase-1 product.

The **root-session node is protected**: it cannot be removed from its own
composition by either delete mode. Deleting the composition is a separate action
with its own confirmation. This keeps the per-root key resolvable.

## 3. Graph model

The implemented pure model is in `src/graph.js`.

```
Composition
  version: 1
  id
  title
  rootSessionId
  nodes[]
  edges[]
  createdAt
  updatedAt

Node
  id                       stable plugin id
  sessionId | null         DSH session, absent for an external leaf
  label
  kind                     'session' | 'external'
  source                   'top-level' | 'subagent' | 'external' | 'unknown'
  provider | null          spawn / fork / acp / codex / ...
  nativeParentSessionId    DSH's immutable parent, for display
  cwd | null               workspace snapshot at attach time
  permissionPreset | null  display snapshot
  addedAt

Edge
  id
  parentId
  childId
  role: 'reports-to'
```

Invariants:

- One node per session id within a composition.
- One incoming `reports-to` edge per node (strict forest); multiple roots are
  allowed.
- No self-edge and no cycle.
- Every edge endpoint exists.
- At most 256 nodes.
- `rootSessionId`, when set, names an attached session node.
- Removing a node promotes its direct reports to roots (`removeNode`); it does
  not delete sessions.
- Removing a subtree deletes the node and every descendant from the composition
  only (`removeSubtree`); it does not delete sessions. Both operations clear
  `rootSessionId` when the removed set contains the root-session node.
- The root-session node is protected by manager/HTTP policy, not by the pure
  model: a request that would remove it is rejected before any write. The model
  stays total and storage-agnostic; protection is a caller decision.

The model is intentionally storage-agnostic. It validates plain JSON so a
corrupt record fails visibly instead of being adopted.

## 4. Persistence

Proposed DSH storage domain (not implemented):

```
domain: combinagents
version: 1
layout: per-record
tables: compositions
```

Record id: `rootSessionId`. Record payload: the composition (including its
`id`) plus `updatedAt`. A session id is stable across resume, so this is a
natural key; the stored `id` is what a future multi-composition scheme keys on.
The returned domain handle is owned by the caller and closed with
`Domain.close()`; one domain name may be open only once at a time.

The domain should use the same conservative pattern as `dsh-extraworkspace`:

- `invalidRecords: 'backup-and-skip'` with `per-record`;
- open failure falls back to an in-memory store and shows a persistence warning;
- never make graph availability depend on the storage backend;
- keep records after a session is archived; they are small.

Potential future tables:

```
combinagents_preferences
  id: 'global'
  lastCompositionByRoot: Record<string, string>
  showNativeLineage: boolean
```

No preferences are needed for the scaffold.

## 5. Host integration

### 5.1 Services

The Host half should inject only what it needs and treat optional services
opportunistically:

- hard: `sessions`, `storageDomain`;
- optional: `sessionQuery`, `workingDirectory`, `sandboxPolicy`,
  `permissionPresets`, `subagents`, `webServer`.

Why optional: the composition view should still open when a profile omits
query, sandbox-policy, or subagent packages. Missing data is displayed as
"unavailable", not fabricated.

### 5.2 Discovery

Build a read-only catalog:

1. `ctx.agents.list()` for live agents and status.
2. `ctx.sessions.list()` for live Session objects.
3. `ctx.sessionQuery.listSessions()` for persisted records not live. If absent,
   only live sessions appear and the UI says persistence discovery is
   unavailable.
4. `ctx.subagents.listDescendants(rootSessionId)` for native catalog rows,
   including external leaves. If absent, native lineage badges are omitted.
5. `ctx.workspaceRegistry.archivedSessionIds` for the true archive set: a
   non-live session is `saved`, not `archived`.

The session picker lists metadata first and folds titles lazily through a
bounded `/titles` batch; it never reads every session log to open.

Do not resume a session just to display it. `sessionQuery` supplies headers and
live flags without activation.

### 5.3 Observation

For each node, read only:

- `session.header` (immutable creation metadata);
- `workingDirectory.get(session)` when both a live Session and the service are
  available;
- `sandboxPolicy.resolve({ session })` for mode and effective root;
- `permissionPresets.current(session)` for the preset label;
- `agent.status` for live activity;
- native catalog rows for the "native parent" badge.

Every value is a snapshot in the HTTP response. Do not cache a live `Session`
reference in durable state.

### 5.4 HTTP bridge

A static Client plugin cannot use the package-private `host.call` bridge. Use
one same-origin prefix route, as `dsh-extraworkspace` does:

```
/dsh-combinagents
```

Routes for phase 1:

```
GET  /bootstrap                    { token, version, platform, supported }
GET  /sessions?query=...           discoverable sessions + metadata
GET  /external?rootSessionId=...   external/one-shot native leaves
GET  /summary?sessionId=...        resolved root, composition size, subagent count
GET  /state?rootSessionId=...      composition + observed nodes
GET  /state?sessionId=...          same, resolved from a member session
GET  /grants?rootSessionId=...     per-edge message/interrupt grants
POST /create                       create empty composition for a root
POST /add-node                     sessionId or external placeholder
POST /add-external                 external placeholder
POST /sync-native                  import existing native descendants
POST /remove-node                  { nodeId, mode: 'promote' | 'cascade' }
POST /set-parent
POST /rename-node
POST /set-grant                    { edgeId, allowMessage?, allowInterrupt? }
GET  /tasks?rootSessionId=...      plugin-owned composition tasks
POST /create-task                  { subject, description?, ownerNodeId? }
POST /update-task                  { taskId, expectedRevision, action }
POST /set-title
```

Rules:

- `application/json`, `cache-control: no-store`;
- 128 KiB body limit;
- loopback peers only;
- per-Host random token in `x-dsh-combinagents-token`;
- no CORS headers;
- validate every session id against the discovered corpus before attaching;
- reject graph mutations with stable typed errors, not generic 500s;
- `remove-node` rejects a node whose `sessionId` equals `rootSessionId` with
  `ROOT_PROTECTED`, whatever the requested mode; deleting the composition is a
  separate endpoint and confirmation;
- `cascade` removes only composition nodes; it never touches a DSH session;
- structural edits return `AGENT_BUSY` (409) while an affected node, one of its
  composition ancestors, or one of its composition descendants is running;
  collateral branches remain editable;
- attaching a session that already belongs to this composition moves its
  subtree under the requested parent (or detaches it to a root); attaching a
  session from another composition moves that subtree, and selecting the source
  root moves that tree;
- cross-composition moves serialize through a merge lock; the source record is
  deleted when empty, otherwise a remaining source root re-keys it;

A future routing phase should add its routes only after the authority design is
settled; do not hide routing behind the phase-1 API.

## 6. Client UI

### 6.1 Placement

One right-sidebar tab type:

```
id:   @dsh-external/dsh-combinagents/composition
kind: dsh-combinagents
```

Register a guide entry so the tab is reachable from the sidebar's add control.
Add a session-header utility button (order after built-in utilities) that calls
`ctx.sidebarRight.openTab('dsh-combinagents')`; fall back to nothing if the
sidebar service is unavailable. Do not duplicate the editor in a modal unless
the fallback is needed.

The graph is wider than a typical sidebar tab. The tab's content should support
the sidebar's fullscreen presentation, and use a vertical tree/list at narrow
widths instead of a free-canvas graph. A free-canvas drag UI is not required for
phase 1.

### 6.2 Screen structure

```
Header
  Title (editable)
  Root session badge
  Reload / fullscreen

Notice
  "Composition edges are advisory. Native messaging and task authority still
  follow DSH's original subagent tree."

Tree
  [source badge] label          native parent: ...
    workspace / mode / preset   live status
    children...

Session picker
  search live + persisted sessions
  show cwd, source, native parent
  Add as node

External leaf
  collapsed by default; expand for provider note, no session, no routing
```

Interaction:

- select a node to see details;
- change parent through a searchable select (keyboard accessible);
- drag/drop can be added after the select path is solid;
- deleting a non-root node opens a dialog with two explicit modes: promote its
  reports to roots, or cascade the subtree; both remove composition nodes only;
- the root-session node offers no delete mode; deleting the composition is a
  separate, confirmed action;
- "open conversation" is enabled only for a live local session; external and
  archived nodes are disabled with a reason. It changes the selected session, so
  the composition tab stays in the root session's layout and returning means
  selecting the root again;
- no action writes to the underlying session.

### 6.3 Visual rules

- Use only theme tokens (`--dsw-alias-*`), no literal colors.
- Source badges must be text + shape, not color-only.
- Distinguish native lineage from composition lineage with labels, not just
  line styles.
- An external node is one collapsed row by default; expanding shows its provider
  and "external execution; cannot receive follow-ups", never a fabricated local
  session. It says so whether or not the `subagents` service is available.
- A stale/unavailable session says so; do not show a blank row.
- All visible strings live in a `dsh-combinagents` locale namespace.

## 7. Model surface

Three static composition control tools:

| Tool | Parameters | Output |
|---|---|---|
| `composition_list_agents` | `{}` | `{ agents: [...] }` |
| `composition_send_message` | `{ agent, message }` | `{ messageId }` |
| `composition_interrupt_agent` | `{ agent }` | `{ accepted }` |

- `agent` accepts a composition node id, session id, or unique label.
- Native `send_message` / `interrupt_agent` / `list_agents` are untouched.
- No system-prompt section and no runtime-context injection.
- Tool definitions are static: composition membership and grants never change the
  schema or description. The install is a one-time tool-prefix change.
- Message delivery builds the native relay envelope:
  `{ kind: 'agent-message', form: 'relay', senderSessionId }` and the
  `Agent <name> sent a message:` prefix.
- Per-edge grants are required along the composition path. Cross-workspace
  delivery without a full-permission session calls `ctx.approval.request`; only
  `allowed-once` proceeds.
- Interrupt is allowed only from a composition ancestor to a descendant and uses
  `subagents.interrupt(target, { kind: 'user' })` after the grant/approval gate.
- Every delivered/denied/approval-denied action writes an audit row; graph state
  is never stored in session events.

The composed mode later replaces these names with the native tool names and
copies the native descriptions; the overlay mode keeps the distinct names above.
`Config.mode: 'composed'` registers six native-name tools plus the plugin-owned
`composition_task`: the three control tools, `subagent`, `subagent_fork`,
`wait_agent`, and the task board tool. `subagent` /
`subagent_fork` call `ctx.subagents.startActivation` with the caller as parent,
mirror the started child into the composition with its native name, and
auto-grant the created edge (configurable with `autoGrantDelegatedEdges: false`).
`send_message` prefers `ctx.subagents.sendMessage`
for native descendants, so cold resume and the native relay source are reused;
live cross-tree targets fall back to `followup`/`steer`. `wait_agent` mirrors the
native caller-inbox wait. Composed mode also restores the native
`subagent:identity` context and `tool:subagent` delegation guidance. Explicit
child LLM selection is validated through the live LLM route and forwarded as
child agent options. Composed
mode is not enabled in the desktop profile. A clean headless profile verified
the real chain: tool list, subagent creation and attachment, wait, follow-up
send with cold resume, second wait, and interrupt. Enabling it in the desktop
profile requires disabling the native subagent control tools and verifying tool
ordering and the prefix fingerprint.

## 8. Cache-friendly constraints

KV/prompt cache reuse is prefix-based. DSH can preserve or disturb prefix
identity; it cannot guarantee a provider cache hit.

- Composition UI adds no prompt text and therefore no cache change.
- Bridge delivery appends a user-role message; it must not rewrite earlier
  messages, the system prompt, or tool schemas.
- Clone/bud must preserve the source `system/message`, tool schema set,
  provider/model/reasoning effort, preset, cwd, and policy when cache reuse is
  desired.
- Clone notices, handoff text, and organizational explanations are appended
  after inherited history, never prepended or inserted into the system prompt.
- Each clone is its own cache lineage. Cloning N children creates N independent
  prefixes; it does not share the source's cache entries.
- Changing cwd, preset, permission policy, or tool set may be required for a
  clone, but it must be labeled as a cache-breaking choice.
- New model tools or prompt sections invalidate the prefix for every affected
  session; Phase 1 must add none.
- Use DSH's fork/seed closing rules for an open tail; do not hand-build an
  unbalanced log.
- Test with a fake LLM adapter by comparing canonical request prefixes, not by
  asserting a provider cache hit.

The complete cache checklist is in [`HANDOFF.md`](HANDOFF.md#6-缓存友好设计硬性原则).

## 9. Permissions and workspace preservation

The plugin's guarantee is negative and testable:

> For every graph mutation, no session header, no working-directory event, no
> sandbox-mode event, no approval-policy event, and no permission-preset event
> is appended; no `registerWritableRoot` or ACL grant is created.

Tests should assert this by instrumenting a fake Session/service and checking
that only the plugin's own storage is written.

Displaying a policy is not changing it. If a session's permission changes later,
the next `/state` read shows the new value; the composition does not pin it.

## 10. Failure handling

| Failure | Behavior |
|---|---|
| Storage unavailable | In-memory composition; visible warning; no crash |
| Corrupt record | Back up/skip; show "composition unavailable"; do not overwrite |
| SessionQuery absent | Live-only discovery; attached persisted nodes remain visible with a notice |
| Session archived | Node remains; status "archived/unavailable"; reopen when resumed |
| Subagents service absent | No external discovery; attached external nodes remain visible with limited details |
| External agent | Discovered conditionally; once attached stays visible, collapsed; actions that require a local session disabled |
| Root-session node removal | Rejected with `ROOT_PROTECTED`; deleting the composition is separate |
| Root session missing | Composition still readable by record id; title falls back |
| Open conversation on external/archived node | Disabled with a reason; no navigation |
| Affected branch is running | Structural edit rejected with `AGENT_BUSY`; siblings stay editable |
| Session already in another composition | `add-node` moves that subtree; selecting the source root moves that tree; a remaining source forest is re-keyed; no rejection |
| Session already in this composition | `add-node` moves its subtree under the requested parent or detaches it to a root |
| Native subagent starts | Mirrored into the owning composition under its native parent; no tool or routing change |
| Graph cycle / duplicate | Rejected with a typed error; no partial write |

Never delete the user's composition because a session disappeared. Session ids
are stable; a temporarily unavailable session may return.

## 11. Implementation phases

### Phase 0 — initial scaffold

- project contract, license, Git;
- pure graph model + tests;
- feasibility and architecture docs;
- inert bundle entry.

### Phase 1 — read-only composition editor (in progress)

Walking skeleton:

- [x] storage domain and manager;
- [x] discovery of live/persisted sessions;
- [x] HTTP bridge;
- [x] right-sidebar tab, header button, guide entry;
- [x] create, add, remove (promote or cascade), delete composition;
- [x] external/catalog leaf discovery;
- [x] reparent/rename UI and node details (open conversation for live local
      sessions);
- [x] observation badges (cwd, sandbox mode, permission preset, native parent);
- [x] shared membership: one composition per session, resolved from any member;
- [x] busy-branch guard for structural edits;
- [x] native `subagent/start` mirror and explicit sync-native import (no
      tool-schema or routing change);
- [x] per-edge `allowMessage` / `allowInterrupt` grants, audit rows, and static
      composition control tools;
- [x] plugin-owned task board (`tasks`, `/tasks`, `/create-task`, `/update-task`)
      with a revision guard and no DSH Team writes;
- [x] composed-mode control/delegation surface: native names for list/send/
      interrupt/subagent/subagent_fork/wait, activation mirroring, and inbox wait
      (implemented behind config; not enabled);
- [x] separate `dsh-combinagents-count` header chip opens this tab; the shipped
      subagent tree entry is retained;
- [ ] install and manual GUI verification (installed; visual check pending).

### Phase 2 — snapshot / clone / bud

- verify a clone spike against the real Host (seed, preset mounting, catalog
  rebuild, permission reconstruction, open-tail closing);
- clone a selected subtree into new Sessions under a new root;
- bud a subagent snapshot into an independent root;
- mark clones with source id and snapshot time;
- preserve cwd, preset, route, and policy where possible;
- compute and check a canonical request-prefix fingerprint;
- clean up partial clones;
- never mutate the source tree.

### Phase 3 — controlled bridge

Only after an explicit product decision:

- per-edge delivery grant for live local sessions;
- append-only delivery with attribution;
- audit log;
- cold-resume ownership policy;
- no external/one-shot delivery;
- no implicit interrupt, archive, or Team authority.

### Phase 4 — hardening and enrichment

- native catalog badges and external leaves;
- live status/token usage;
- archived/stale handling;
- Team task copy/remap decision;
- accessibility, keyboard, narrow-width and theme pass;
- DSH version re-verification.

## 12. Acceptance criteria for phase 1

1. A composition can be created for a root session and survives a Host restart.
2. Sessions from at least two different workspaces and at least one native
   subagent appear as nodes with correct source and native-parent badges.
3. Reparenting rejects cycles, duplicate sessions, self-edges, and second
   parents without writing partial state.
4. Removing a non-root node offers promote or cascade; both remove only
   composition nodes. The root-session node is rejected with `ROOT_PROTECTED`,
   and deleting the composition is a separate action.
5. External agents are discovered conditionally; an attached external node stays
   visible without the `subagents` service, collapsed by default, with routing,
   clone, and open-conversation actions disabled.
6. Open conversation is enabled only for a live local session and never writes
   to that session.
7. The UI clearly states that the overlay does not change native messaging.
8. No new model tools or prompt text are registered.
9. No session header, cwd, sandbox, approval, or permission-preset write occurs.
10. Unit tests pass; the GUI is checked in light/dark themes and at narrow width.
11. A DSH-side smoke test verifies the tab opens from the header button and the
    guide.

### Phase 2 acceptance

1. A tree with at least two child Sessions clones into a new tree with new ids.
2. The source tree, its headers, catalogs, Activations, and policies are
   unchanged.
3. The clone's canonical request prefix matches the source up to inherited
   history when cwd/preset/route/tools are unchanged.
4. Clone notices are appended, not prepended.
5. A failed clone leaves no published half-tree.
6. The clone can create a new child (depth/capacity permitting).

### Phase 3 acceptance

1. A granted edge delivers only to the intended live local target.
2. Delivery is append-only and attributed; the recipient's earlier prefix is
   unchanged.
3. External, archived, and unauthorized targets are rejected.
4. No native `send_message`, Team, interrupt, or archive authority is granted by
   the edge.
5. Every delivery has an audit record.

## 13. Risks

- **Expectation gap.** Users may assume reparenting changes `send_message`.
  Mitigate with persistent copy, not a one-time warning.
- **Stale observations.** cwd/policy can change after a node is attached. Treat
  them as observations, not configuration.
- **External agents.** They cannot be resumed; the UI must not offer follow-up.
- **Session deletion.** DSH does not expose a stable "deleted" event for all
  paths; a node may outlive its session. Keep it and show unavailable.
- **Release drift.** The subagent/session contracts are release-sensitive. Pin
  the verified DSH version in docs and re-review before claiming support.
- **Scope creep into routing.** Routing is the point where the clean permission
  story ends. Keep it a separately approved phase.
