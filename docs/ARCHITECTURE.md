# Architecture proposal

**Status:** Phase 1 is installed in the `desktop` profile and was visually
verified on 2026-11-17 in dark/light themes and at 420 px width. The Host
bridge, durable domain write, root protection, shared membership resolution,
busy-branch guard, native-subagent mirror, client slot occupants, and the
rendered tab are verified. The model surface is merged into the standard
profile: a `tools/execute` interceptor replaces the execution path for six
native tools while their model-facing contracts stay byte-for-byte native. The
legacy composed preset remains on disk only for old sessions; `standard` is the
default for new sessions.

**Scope update:** the authoritative product brief is
[`HANDOFF.md`](HANDOFF.md). It adds **snapshot/clone** (branch a team, bud a
subagent as a new root; implemented and live-verified on 2026-11-18) and a
**controlled bridge** (explicitly
authorized cross-tree messages; implemented as the composition control tools,
not a separate layer). Clones are new Sessions, never native re-parenting.

**Decision record (2026-11-16, reading A):** storage is one profile-level
`combinagents` domain holding one record per root session; ownership, UI entry,
and lifecycle stay per-root. The root-session node is protected from removal.
Delete is promote-or-cascade for non-root nodes; external agents are discovered
conditionally but stay visible once attached, collapsed by default; the node
detail may open any local session (including persisted ones). See §2, §3, §5.4,
§6, §10, §12.

The recommended product starts with an **overlay composition**: a user-owned
reporting graph layered over DSH's immutable native agent lineage. The overlay is
stored by this plugin, never by rewriting a session. Each node keeps the
workspace, sandbox mode, approval policy, and tool composition it already has.

Read [HANDOFF.md](HANDOFF.md) and [FEASIBILITY.md](FEASIBILITY.md) first. In
particular:

- Native re-parenting is not a plugin feature.
- Overlay edges do not by themselves change native `send_message` authority;
  the merged execution interceptor implements the composition bridge.
  Messages use an edge grant, root authority, or native-tree ancestry without a
  per-message approval prompt; native-tree cold targets are restored by the
  native subagent service, never by a bare `ctx.agents.resume`; plain top-level
  targets may use `ctx.agents.resume` with a retained/disposed handle.
  Interrupts use grants plus approval.
- Six native names keep their native definitions; a `tools/execute` interceptor
  supplies composition values. `composition_task` is the legacy aggregate; when
  native Agent Teams is absent the plugin also registers four Team-shaped task
  tools plus `team_list` over the composition-owned board; they are exposed only
  when the caller belongs to a composition. Native tool schemas are unchanged.
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
  mode                     'continuable' | 'one-shot' | 'external' | 'unknown'
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

Implemented DSH storage domain:

```
domain: combinagents
version: 1
layout: per-record
tables: compositions, policies, audit, audit_archive, tasks, clones, teams
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

### Team records and task scope

`teams` is a separate table in the same domain:

```text
team: { id, rootSessionId, rootNodeId, nodeIds?, label, createdBy, createdAt, updatedAt }
```

- `rootNodeId` is the Team Lead and must be a local session node.
- `nodeIds` is the exact member set. New Teams always store it explicitly;
  legacy records without it fall back to the Lead's connected subtree.
- Creation rejects disconnected selections (`TEAM_NOT_CONNECTED`), non-session
  members, one-shot members, a Lead outside the set, duplicate labels, and
  overlap with another Team (`TEAM_OVERLAP`).
- Every graph save validates existing Teams. Removing/moving a member,
  disconnecting the selected set, or creating an overlap is rejected with
  `TEAM_STRUCTURE_CONFLICT`; delete the Team first to change its structure.
- `team` task tools accept an optional Team id or unique label. The composition
  root may address every Team; another caller is limited to a Team it belongs
  to. `team_list` exposes the discoverable Teams.
- The Client remembers the selected Team per composition in `localStorage`.
- Task records carry an optional `teamId`; Team boards filter by it, and owner /
  claim / dependency / reassign rules are scoped to the Team.
- Team deletion removes its scoped tasks only. It never removes composition
  nodes or DSH sessions.
- Clone/bud copies Team records whose member nodes are in the selected tree and
  remaps their task `teamId`.
- If a later reparent changes the graph, the stored member set is still the
  Team's scope; the save is rejected rather than silently shrinking it. Delete
  the Team before changing its membership. The consolidated HTTP/tool contract
  is in [`TEAM-API.md`](TEAM-API.md).

### Cross-profile coherence

The DSH domain runtime is authoritative **in memory per open domain**. Two Host
profiles that share `$DSH_HOME/storages/combinagents` therefore hold separate
snapshots; a write in one is invisible to the other until it reopens the
domain. The plugin adds three coherence mechanisms:

- **Revision marker:** after every durable composition, policy, task, Team, or
  clone write, the writer atomically replaces `storages/combinagents/.revision` with a
  token. Every store read checks the marker; when it differs, the domain is
  closed and reopened from the backend snapshot. The store generation changes,
  and the manager rebuilds its session→composition membership index.
- **Mutation lock:** composition mutations take a process-shared
  `storages/combinagents/.mutation.lock` (stale after 30 s) around the
  read-modify-write. The lock is re-entrant within one process via
  `AsyncLocalStorage`, so nested per-root locks reuse the outer lock and
  cross-profile moves serialize.
- **UI convergence:** the tab re-fetches `/state` every 3 s while visible and
  the header chip re-fetches `/summary` every 5 s. A poll never overwrites an
  in-flight local mutation.

The store still uses the DSH storage domain as the only data owner; the marker
and lock are tiny sidecars under the same directory, not a parallel record
format. A custom storage backend outside the default directory needs the
`storageDir` option for these sidecars.

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
GET  /titles?ids=...               lazy title batch for the picker
GET  /external?rootSessionId=...   external/one-shot native leaves
GET  /summary?sessionId=...        resolved root + composition size + cached native count
GET  /state?rootSessionId=...      composition + observed nodes + Teams
GET  /state?sessionId=...          same, resolved from a member session
GET  /grants?rootSessionId=...     per-edge message/interrupt grants
POST /create                       create empty composition for a root
POST /add-node                     sessionId or external placeholder
POST /add-external                 external placeholder
POST /sync-native                  import existing native descendants
POST /remove-node                  { nodeId, mode: 'promote' | 'cascade' }
POST /set-parent
POST /rename-node
POST /set-title                    { title }
POST /set-grant                    { edgeId, allowMessage?, allowInterrupt? }
GET  /tasks?rootSessionId=...      plugin-owned composition tasks
GET  /teams?rootSessionId=...      composition-scoped Teams
POST /create-team                  { rootSessionId, rootNodeId, label? }
POST /delete-team                  { rootSessionId, teamId }
POST /create-task                  { subject, description?, ownerNodeId?, teamId? }
POST /update-task                  { taskId, expectedRevision, action, teamId? }
POST /delete-composition           remove the overlay record; sessions untouched
GET  /session-cleanup              preview tracked orphan/one-shot cleanup candidates
GET  /session-cleanup/session?sessionId=...  brief first-user/last-message excerpt
POST /session-cleanup              { sessionIds?, oneShotNodeIds?, includeLegacy? }
GET  /clone-estimate?rootSessionId=&nodeId=  new-session count + copied-history bytes
```

Title editing is implemented through `/set-title` and the tab header. A
user-created connection defaults to bidirectional messaging
(`allowMessage: true`, `allowInterrupt: false`); direct reparenting migrates an
existing grant and otherwise defaults the replacement edge to messaging;
detaching removes the grant, and native-mirrored edges stay at the deny
default.

Rules:

- `application/json`, `cache-control: no-store`;
- 128 KiB body limit;
- loopback peers only, with an exact loopback `Host` (`127.0.0.1:<port>`,
  `localhost:<port>`, or `[::1]:<port>`) and, when present, a same-origin
  loopback `Origin`; `/bootstrap` is authenticated by the same checks;
- per-Host random token in `x-dsh-combinagents-token`, compared with `timingSafeEqual`;
- no CORS headers; JSON-only POST bodies; `nosniff`/same-origin resource policy;
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
- `sync-native` and `auto-attach` skip a session already owned by another
  composition and log the refusal; `installComposition` rejects such a session
  with `SESSION_ALREADY_COMPOSED`, and membership is never silently overwritten;
- cross-composition moves serialize through the merge lock plus both per-root
  locks in lexical order; the target is saved first, a source failure rolls it
  back, and membership is reindexed only after both records settle;
- tasks record `createdBy` and audit actor; only the owner or one of its
  composition ancestors may change a task (`TASK_FORBIDDEN` otherwise);

### 5.5 Session cleanup

`src/session-cleanup.js` is the only destructive session path. DSH 0.2.2-rc.5
has no public session-delete service, so it operates on the default
`$DSH_HOME/sessions` JSONL directory (overridable with `sessionRoot`) and only
after a user-confirmed request:

- refuse when composition storage is memory-backed or degraded; a missing
  composition view must not make a member look ownerless;
- preview tracked `failed`/`orphaned` clone sessions, opt-in historical
  `isSeeded` sessions with no composition (covers clone roots and
  `subagent_fork` mirror misses), and leaf one-shot nodes/placeholders;
- list preview is metadata-only; a separate `session-cleanup/session` read opens
  a bounded first-user/last-message excerpt for one eligible candidate on demand,
  so reviewing content does not read every cold log;
- never delete a live session, a composition member, a native ancestor of a
  member, or a clone provenance source;
- require `includeLegacy: true` for historical suspects;
- delete the exact session directory under the real session root, then detach
  workspace accounting and remove archive/pin entries;
- remove a clone record only after every Session it maps is gone;
- write a `session-cleanup` audit row; it does not reclaim shared
  attachments/cache files.

`GET /clone-estimate` is advisory: it reports selected node count and the sum of
persisted source-session bytes before the clone/bud confirmation; the clone
route revalidates the plan.

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
sidebar service is unavailable. Add a separate `dsh-combinagents-count` chip in
`conversation.session.header.actions` (order 11); never reuse the native
`subagent-catalog` id. Do not duplicate the editor in a modal unless the fallback
is needed.

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
  follow DSH's original subagent tree.

Teams
  Team selector (composition board or a connected subtree)
  Create team / delete team; task board follows the selected scope


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
- "open conversation" is offered for every local session node, including
  persisted/archived ones; external nodes are disabled with a reason. Whether an
  archived session can actually resume is left to the DSH workspace. It changes
  the selected session, so the composition tab stays in the root session's
  layout and returning means selecting the root again;
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

The model surface is merged into the standard profile. The plugin keeps the
native tool definitions intact and registers one `tools/execute` interceptor:

- for `list_agents`, `send_message`, `interrupt_agent`, `subagent`,
  `subagent_fork`, `wait_agent`, it returns `{ isError: false, value }` from the
  composition handler instead of calling `next()`;
- the native definition, schema, description, output renderer, presentation,
  prompt identity/guidance, restrictions, concurrency metadata, and timeout are
  unchanged;
- the DSH pipeline validates the canonical value against the native output
  schema and renders it through the native output declaration;
- non-intercepted names call `next()` unchanged.

`composition_task` and, when native Agent Teams is absent, the four
Team-shaped task tools are composition-scoped extras. Native Team wins when
mounted. The old `composition_*` aliases are removed. `list_subagent_models` and every other
unique native tool are untouched.

Semantics:

- `list_agents` returns the native-shaped `{ name, status, description? }` array;
  `name` is the composition label and `status` is `running` / `inactive`. Rows
  carry `mode=<continuable|one-shot|external|unknown>` in `description`;
  one-shot and external rows are omitted, matching native continuable listing.
- `send_message` rejects a one-shot target (no follow-up), matching native
  lifecycle; `interrupt_agent` may still interrupt a live one-shot target.
- `send_message` / `interrupt_agent` resolve composition labels, node ids, or
  session ids. Messages are allowed by a per-edge `allowMessage` grant, the
  composition root, or existing native-tree ancestry; inactive local targets
  are restored by the native subagent service when they belong to the native
  tree. Interrupts require the corresponding per-edge grant. Native-tree targets still prefer the native
  relay. Live cross-tree targets use the composition relay. Cross-workspace
  interrupts without a full-permission caller ask through
  `ctx.approval.request`; only `allowed-once` proceeds.
- `subagent` / `subagent_fork` call `ctx.subagents.startActivation`, mirror the
  started child with its native name, and auto-grant the delegation edge
  (configurable with `autoGrantDelegatedEdges: false`). The native `agent_preset`
  field is forwarded when the native schema exposes it; a plugin `agentPreset`
  config can supply the deployment default.
- `wait_agent` mirrors native caller-inbox wait semantics and de-duplicates
  already-reported input within one root call.
- `composition_task` lists/creates/updates the plugin-owned board; the four
  Team-shaped tools expose it with native Team field names/actions and never
  write DSH Team state.
- No plugin prompt section is added; the native `subagent:identity` and
  `tool:subagent` sections remain in place.
- Tool definitions are static; composition membership and grants never change a
  schema or description. Installation is an execution listener, not a global
  tool-prefix change.

The native delegation rows (`tool-subagent-control`, `tool-subagent`,
`tool-subagent-fork`) must stay mounted. Do not use the legacy composed preset
that removes them; it has no native definitions to intercept and only receives
the plugin's static fallback definitions.

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
| Open conversation on external node | Disabled with a reason; no navigation |
| Open conversation on archived local node | Button is offered; the workspace may refuse to resume; the plugin writes nothing |
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

### Phase 1 — read-only composition editor (completed)

Walking skeleton:

- [x] storage domain and manager;
- [x] discovery of live/persisted sessions;
- [x] HTTP bridge;
- [x] right-sidebar tab, header button, guide entry;
- [x] create, add, remove (promote or cascade), delete composition;
- [x] external/catalog leaf discovery;
- [x] reparent/rename UI and node details (open conversation for local sessions,
      including persisted and archived ones);
- [x] composition title editing through `/set-title` and the tab header;
- [x] manual connections default to bidirectional messaging; direct reparenting
      migrates grants, detaching removes them, and native-mirrored edges stay
      denied;
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
      (enabled and loaded in the desktop profile);
- [x] separate `dsh-combinagents-count` header chip opens this tab; the shipped
      subagent tree entry is retained;
- [x] install and manual GUI verification (2026-11-17; dark/light/420 px; picker,
      details, rename/reparent, grants, external, tasks, create/delete,
      sync-native, both header entries, native catalog retained);
- [x] count chip refreshes after tab mutations; narrow rows keep whole controls.

### Phase 2 — snapshot / clone / bud

- [x] pure clone/bud planner (`src/clone.js`): whole root tree, clone markers,
      task-copy owner mapping; source-level DSH API spike in
      [`CLONE-SPIKE.md`](CLONE-SPIKE.md);
- [x] live Host adapter: seed a new root, create cataloged children, preserve
      permission/cwd/preset, attach to the source workspace, depth-first idle
      children, failure cleanup;
- [x] live two-node Host spike against the real Host (seed, preset mounting,
      catalog rebuild, permission reconstruction, open-tail closing);
- [x] clone the **whole root tree** into new Sessions under a new root (no
      subtree-only selection);
- [x] bud a subagent snapshot plus its subtree into an independent root; keep the
      original node, never auto-archive it, and leave two parallel trees;
- [x] copy the plugin-owned task board and remap each owner to the cloned node;
- [x] preserve cwd, preset, route, and policy; the UI exposes no override;
- [x] mark clones with source id and snapshot time;
- [ ] compute and check a canonical request-prefix fingerprint;
- [x] clean up partial clones;
- [x] never mutate the source tree;
- [x] live GUI re-verification of the clone badge/details, a two-node clone, and
      a larger multi-agent clone; clone roots appear in the source workspace and
      stay idle while cloned children are cataloged and saved;
- [x] build wide trees depth-first so the Host's eight-active-child limit cannot
      be exceeded, and use `delivery: 'caller'` so disposing a cloned child does
      not wake the clone root.

### Phase 3 — controlled bridge (implemented as composition tools)

- per-edge delivery grant for local sessions; native descendants may cold-resume
  through the native service;
- append-only delivery with attribution;
- audit log;
- external/one-shot delivery rejected;
- interrupt is a separate per-edge grant and only ancestor-to-descendant;
- no implicit archive or Team authority.

Audit rows rotate from `audit` into `audit_archive` so retention evidence is
not silently deleted; an audit viewer remains future work. Remaining: document
the archived/cold-resume boundary and consider an audit viewer.

### Phase 4 — hardening and enrichment

- native catalog badges and external leaves;
- live status/token usage;
- archived/stale handling;
- Team task copy/remap decision;
- accessibility, keyboard, narrow-width and theme pass;
- cross-composition moves: the new parent connection defaults to messaging, but the moved subtree's internal grants still start from deny;
- large-composition tab paint under an oversized session transcript;
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
6. Open conversation is offered for local session nodes (including persisted
   ones) and never writes to that session; external nodes are disabled.
7. The UI clearly states that the overlay does not change native messaging.
8. Standard mode keeps the native delegation plugins mounted; one
   `tools/execute` interceptor replaces execution for six native names while
   their schemas/descriptions/output/prompt identity/restrictions stay native;
   `composition_task`, `team_list`, and the Team-shaped task tools are conditional
   on the caller having a composition (unless native
   Team is mounted). Removing the listener restores the native path.
9. No session header, cwd, sandbox, approval, or permission-preset write occurs.
10. Unit tests pass; the GUI is checked in light/dark themes and at narrow width.
11. A DSH-side smoke test verifies the tab opens from the header button and the
    guide.

Verified on 2026-11-18: criteria 1, 3-11 through the 146 unit tests and the real
GUI (dark/light/420 px). Criterion 2 was demonstrated by adding a
a multi-agent workspace session to a `dsh-combinagents` composition and by the rich
composition with 15 native subagent nodes; the cross-workspace node was removed
afterward. The live profile had no discovered external child, so the picker's
external-add click was not exercised; `/external` followed by `/add-external`
is covered by a fake-catalog bridge test instead. The guide entry is registered
and covered by the client test; the header utility and count chip were clicked
live. Title editing and grant migration are covered by manager/HTTP tests; their
Host-side routes require the next Host restart before a live GUI pass.

### Phase 2 acceptance

1. A whole root tree (root plus every child and external placeholder) clones
   into a new tree with new Session ids.
2. The source tree, its headers, catalogs, Activations, and policies are
   unchanged.
3. The clone's canonical request prefix matches the source up to inherited
   history; cwd, preset, route, tool set, and policy are unchanged because the
   UI exposes no override.
4. Clone notices are appended, not prepended.
5. A failed clone leaves no published half-tree.
6. The clone can create a new child (depth/capacity permitting).
7. The plugin-owned task board is copied and every owner is remapped to the
   cloned node.
8. Budding a subagent keeps the original node, never auto-archives it, and
   leaves two parallel independent trees.

### Phase 3 acceptance

1. A granted edge delivers only to the intended live local target.
2. Delivery is append-only and attributed; the recipient's earlier prefix is
   unchanged.
3. External and unauthorized targets are rejected; an archived target is
   rejected unless the native relay can cold-resume it for a native descendant.
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
  story ends. Keep it separately approved.
- **Manual connections default to messaging.** A user-added or reparented edge
  starts with `allowMessage: true` and `allowInterrupt: false`; a migrated
  explicit grant, including an explicit deny, is preserved. Detaching removes
  the grant. Native-mirrored edges and the internal edges of a cross-composition
  move still start from deny.
- **Archived nodes still offer "open conversation".** This is intentional: the
  workspace decides whether the session can resume.
- **Large-session tab paint.** A 16-node composition under an oversized live
  transcript can keep the tab's loading state for tens of seconds even though a
  warm `/state` returns in low milliseconds; the remaining cost is the
  surrounding transcript UI.
