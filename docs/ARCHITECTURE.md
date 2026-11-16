# Architecture proposal

**Status:** proposal for the scaffold. Nothing below except `src/graph.js` is
implemented yet. The bundle entry is inert.

The recommended product is an **overlay composition**: a user-owned reporting
graph layered over DSH's immutable native agent lineage. The overlay is stored
by this plugin, never by rewriting a session. Each node keeps the workspace,
sandbox mode, approval policy, and tool composition it already has.

Read [FEASIBILITY.md](FEASIBILITY.md) first. In particular:

- Native re-parenting is not a plugin feature.
- Overlay edges do not change `send_message` authority.
- Phase 1 adds no model-facing tools.
- External/one-shot agents can be visible leaves but cannot receive follow-ups.

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

A composition is owned by one **root session**: the session whose right-sidebar
tab is open when the user creates it. One composition per root session for
phase 1. The composition may contain sessions from other roots and other
workspaces; ownership only decides where the composition is stored and which UI
opens it.

This has three useful properties:

1. The durable key is a real DSH session id, not a synthetic profile-level id.
2. A session can be shown in more than one root's chart without its own state
   being duplicated.
3. Archiving the root does not delete the composition; it remains readable when
   the session is resumed.

Open question: whether later versions should allow multiple named compositions
per root, or a profile-level composition independent of any root.

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
- Removing a node promotes its direct reports to roots; it does not delete
  sessions.

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

Record id: `rootSessionId`. Record payload: the composition plus
`updatedAt`. A session id is stable across resume, so this is a natural key.

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
GET  /state?rootSessionId=...      composition + observed nodes
POST /create                       create empty composition for a root
POST /add-node                     sessionId or external placeholder
POST /remove-node
POST /set-parent
POST /rename-node
POST /set-title
```

Rules:

- `application/json`, `cache-control: no-store`;
- 128 KiB body limit;
- loopback peers only;
- per-Host random token in `x-dsh-combinagents-token`;
- no CORS headers;
- validate every session id against the discovered corpus before attaching;
- reject graph mutations with stable typed errors, not generic 500s.

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
  label + provider note; no session, no routing
```

Interaction:

- select a node to see details;
- change parent through a searchable select (keyboard accessible);
- drag/drop can be added after the select path is solid;
- removing a node warns that its reports become roots;
- no action writes to the underlying session.

### 6.3 Visual rules

- Use only theme tokens (`--dsw-alias-*`), no literal colors.
- Source badges must be text + shape, not color-only.
- Distinguish native lineage from composition lineage with labels, not just
  line styles.
- An external node says "external execution; cannot receive follow-ups".
- A stale/unavailable session says so; do not show a blank row.
- All visible strings live in a `dsh-combinagents` locale namespace.

## 7. Model surface

Phase 1: **none**.

- No new tools.
- No system-prompt section.
- No runtime-context injection.
- No changes to `subagent`/`send_message` schemas.

Rationale: the graph is a human coordination view, not a new authority. Adding a
tool would force every model request to pay schema cost and would create a new
cross-tree messaging authority that DSH deliberately does not have.

If phase 2 adds routing, prefer one explicitly named tool over overloading
`send_message`, and require a visible, per-edge user grant. Revisit whether the
value justifies the model surface.

## 8. Permissions and workspace preservation

The plugin's guarantee is negative and testable:

> For every graph mutation, no session header, no working-directory event, no
> sandbox-mode event, no approval-policy event, and no permission-preset event
> is appended; no `registerWritableRoot` or ACL grant is created.

Tests should assert this by instrumenting a fake Session/service and checking
that only the plugin's own storage is written.

Displaying a policy is not changing it. If a session's permission changes later,
the next `/state` read shows the new value; the composition does not pin it.

## 9. Failure handling

| Failure | Behavior |
|---|---|
| Storage unavailable | In-memory composition; visible warning; no crash |
| Corrupt record | Back up/skip; show "composition unavailable"; do not overwrite |
| SessionQuery absent | Live-only discovery; persistent sessions hidden with a notice |
| Session archived | Node remains; status "archived/unavailable"; reopen when resumed |
| External agent | Visible leaf; actions that require a local session disabled |
| Root session missing | Composition still readable by record id; title falls back |
| Graph cycle / duplicate | Rejected with a typed error; no partial write |

Never delete the user's composition because a session disappeared. Session ids
are stable; a temporarily unavailable session may return.

## 10. Implementation phases

### Phase 0 — scaffold (this commit)

- project contract, license, Git;
- pure graph model + tests;
- feasibility and architecture docs;
- inert bundle entry.

### Phase 1 — read-only composition editor

- storage domain and manager;
- discovery of live/persisted sessions;
- HTTP bridge;
- right-sidebar tab, header button, guide entry;
- add/remove/reparent/rename;
- observation badges;
- tests and manual GUI verification.

### Phase 2 — native enrichment

- native catalog tree badges and external leaves;
- live status/token usage;
- archived/stale handling;
- accessibility and keyboard pass.

### Phase 3 — optional coordination

Only after an explicit product decision:

- per-edge routing capability for live local sessions;
- audit log;
- cold-resume ownership policy;
- no external/one-shot delivery.

### Phase 4 — optional materialization

- create a new native tree from the chart with per-node `cwd`/preset;
- label new agents as clones, not as the attached originals;
- do not copy permissions silently.

## 11. Acceptance criteria for phase 1

1. A composition can be created for a root session and survives a Host restart.
2. Sessions from at least two different workspaces and at least one native
   subagent appear as nodes with correct source and native-parent badges.
3. Reparenting rejects cycles, duplicate sessions, self-edges, and second
   parents without writing partial state.
4. Removing a node leaves its reports as roots and deletes nothing from DSH.
5. The UI clearly states that the overlay does not change native messaging.
6. No new model tools or prompt text are registered.
7. No session header, cwd, sandbox, approval, or permission-preset write occurs.
8. Unit tests pass; the GUI is checked in light/dark themes and at narrow width.
9. A DSH-side smoke test verifies the tab opens from the header button and the
   guide.

## 12. Risks

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
