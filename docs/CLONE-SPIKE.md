# Clone / Bud spike — DSH API findings

**Status:** source-level and live two-node Host spike complete against DSH
`0.2.2-rc.3`. Root clone, seeded child, native catalog entry, and the
persisted-idle child strategy all passed. The formal whole-tree adapter is
implemented in `src/clone-manager.js` with the `/clone-tree` and `/bud` routes.
The temporary `/clone-spike` route and provider were removed on 2026-11-18;
those diagnostics are not part of the product API. The formal adapter was
live-verified with two-node and 16-node clones on 2026-11-18.

## 1. Confirmed product decisions

- Clone the **whole tree rooted at the composition root session**; do not offer
  a middle-subtree selection.
- Copy the plugin-owned `tasks` board and remap every `ownerNodeId` to the
  cloned node.
- Do not allow cwd / preset / permission overrides during clone; preserve the
  source values.
- Budding a subagent keeps the original node, never auto-archives it, and leaves
  two parallel independent trees.

## 2. What DSH already supports

### Root creation with a seed

`CreateAgentOptions` (`packages/core/agent/src/index.ts`) supports:

- `seed` — contiguous events from seq 0;
- `inheritedEventCount` — exact copied prefix length;
- `meta.cwd`, `meta.isSeeded`, `meta.agentPreset`, `meta.parentSession`,
  `meta.origin`, `meta.delegationDepth`;
- `setup` — mount the resolved agent preset before publication;
- `agentOptions` — provider/model/effort route.

`SessionStore.fork` (`packages/core/session/src/index.ts`) copies a live
session's prefix, `cwd`, and `isSeeded`; it does **not** create a native child
catalog entry. The ordinary session-controller fork command
(`packages/api/session-controller/src/commands.ts`) shows the canonical root
recipe: read `sessionQuery.observeSession`, `buildForkSeed`, resolve the source
preset through `agentPresets`, then `ctx.agents.create` with the seed and
`setup`. It preserves the source `cwd` and `agentPreset`; it does not attach the
new session to a native parent.

### Permission preservation is automatic for seeded sessions

`PermissionPresetService.pinInitialPermission`
(`packages/interaction/permission-presets/src/index.ts`) fills only missing
permission facts for a seeded/partially initialized session. If the copied
prefix includes the source `permission/preset`, sandbox-mode, and approval
events, the clone's effective preset is preserved without a
`permissionPresets.set` write. That matches the "no override" decision and
keeps the graph-mutation invariant intact.

### Child creation with a seed

`startActivation` + a provider with `prepareContinuable`
(`packages/subagent/subagent/src/index.ts`,
`packages/subagent/subagent-fork-in-process/src/index.ts`) is the public path
that creates a **native child**: the manager reserves the child id, sets
`parentSession`/`origin: 'subagent'`/`delegationDepth`, creates the agent with
the seed, and appends the parent-owned `subagent/catalog` entry. A seeding
provider returns a raw completed-turn prefix; the session constructor and
manager add the inherited marker/closers.

`ContinuableCreateRequest` exposes the parent and reserved child id, not an
arbitrary source id. A clone provider therefore needs a closure map
`childId -> sourceSessionId`, filled before each `startActivation` call. Its
`prepareContinuable` reads the source observation, picks the latest completed
turn boundary (same rule as `latestCompletedPrefixBoundary`), and returns the
raw prefix.

### What is not available

- There is no public "attach an existing session as a child" API.
- `startActivation` always submits an initial prompt and wakes a turn; it does
  not create an idle cataloged child.
- The root clone's route comes from the current default model selection, not
  from the source header. The source preset/cwd/permission can be preserved;
  the exact provider/model route is not recovered from the session header.
- External placeholders have no local session to fork; they can only be copied
  as external placeholders with a `cloneOf` marker.

## 3. Proposed adapter

1. **Plan** the clone with a pure function: root node + all composition
   descendants, edges by source node id, task copy with owner remap, clone
   markers (`cloneOf`, `snapshotAt`, `sourceCompositionId`).
2. **Root**: `ctx.agents.create` with `seed`, `inheritedEventCount`, `meta.cwd`,
   `meta.isSeeded`, `meta.agentPreset`, and a `setup` that mounts the source
   preset via `agentPresets.resolve/mount`. The source prefix carries the
   permission facts.
3. **Children**: register a plugin-owned provider (for example
   `combinagents-clone`). For each source child in parent-before-child order:
   map the reserved child id to the source session, call `startActivation` with
   the source `cwd`, source `agentPreset`, and a short clone notice as the
   initial prompt. The manager creates the session, catalog entry, and native
   ownership.
4. **Idle question**: the initial prompt starts a turn. The spike must decide
   between (a) accept one small acknowledgement turn per cloned child, or
   (b) dispose the activation immediately after catalog establishment and
   verify the child remains a usable persisted catalog child. Do not hand-write
   `subagent/catalog`.
5. **Tasks**: copy `tasks` rows, reset `revision` to 1, remap `ownerNodeId`
   through the node mapping, and write them under the clone root.
6. **Composition**: create a new composition record for the cloned root with
   cloned `sessionId`s and `cloneOf` markers; never mutate the source record.
7. **Failure cleanup**: if any child creation fails, dispose created
   activations, remove the partial clone composition and tasks, and leave the
   source untouched.

## 4. Temporary `/clone-spike` route (removed)

The diagnostic route and its `combinagents-clone-spike` provider were deleted
after the formal adapter, `/clone-tree`, and `/bud` were exercised live. The
findings they produced are kept below; do not reintroduce the route.

## 5. Live Host results (2026-11-17)

Source pair: `session-0a6fe925...` (root) and `8f4b1535...` (native child).

- clone root: seeded, `cwd` preserved, permission `workspace-write`, source unchanged;
- clone child: `parentSession` points at the clone root, `origin: subagent`,
  `delegationDepth: 1`, `isSeeded: true`, `cwd` preserved;
- catalog: the clone root log contains the inherited source catalog plus the new
  `subagent/catalog`; the `subagentCatalog` projection reports one child;
- `delivery: "parent"` was required in this Host for the child path;
- `mode: "dispose"` leaves the child `live: false`, `persisted: true`, and
  discoverable; the root remains live;
- `mode: "live"` keeps the child live; the cleanup action disposes it and the
  clone root;
- installed Host note: `subagents.listChildren` returned `[]` even though the
  observation projection had one catalog entry; use `listDescendants` or read
  the projection directly in the adapter.

**Chosen idle strategy:** create the root idle; for each source child keep the
activation live while creating its descendants, then dispose activations in
post-order. The child sessions remain persisted/native catalog members and can
be cold-resumed later. The root stays live.

**Caveats:** the source child had no explicit `agentPreset`, so the clone child
inherited the clone root's `composed` preset; an explicit source preset is
forwarded and preserved. Source permissions were not observable on the
persisted source child, so exact permission preservation still needs a source
with explicit permission events.

## 6. Formal adapter live results (2026-11-18)

The product routes `/clone-tree` and `/bud` replaced the debug route.

- Two-node source `session-0a6fe925...`: clone root `session-448e8a4e...` was
  live, retained `workspace-write`, and appeared in the source workspace; its
  cloned child `session-9f3cac9c...` was cataloged, `live: false`,
  `persisted: true`, and pointed at the clone root. The clone root log ended at
  the inherited `turn/end`, with only the new `subagent/catalog` appended; no
  new turn started.
- The copied task `Clone task acceptance` reappeared on the clone root's board
  as `pending`, owned by the cloned root node, and was visible in the GUI.
- The 16-node mahjong composition cloned in about 10 seconds: root
  `session-27534c3a...`, 15 cloned children, 15 edges, zero external nodes, and
  15 catalog entries. All 15 children were `live: false`, `persisted: true`.
  The source composition still had 16 nodes/15 edges and no clone markers.
- `workspaceRegistry.attachSession` adds the clone root to the workspace matched
  by the source's session membership or, when that membership is absent, by the
  source cwd. The 16-node clone appeared under the `mahjong` workspace.
- The Host enforces **8 active children per parent**. Building all children live
  first failed on child 9 with `subagent limit reached (active child limit: 8)`.
  The adapter now builds depth-first and disposes each child after its subtree,
  so a wide tree peaks at one active child.
- `delivery: "caller"` still commits the native catalog, but suppresses the
  settlement message that `delivery: "parent"` injects into the clone root.
  With `parent`, disposing each child woke the clone root and it started a new
  turn; with `caller`, the root stayed idle.
- GUI checks: root shows `克隆 / 活跃 / 根会话`; children show `克隆 / 已保存`;
  the tab header shows `Agent composition (clone)`, `16 个节点`, and the clone
  badge details.

Permission preservation was checked with an explicit child policy: cloned
children in the 16-node tree carry `sandbox/mode: workspace-write` and
`approval/policy: never` with `source: delegation` in their copied prefix,
matching their source children; a bud of the same source child
(`session-b4b55f34...`) reported `permissionPreset: custom` and
`approvalPolicy: never`. Still open: the canonical request-prefix fingerprint.

## 7. Risks / open items

- **Idle child semantics** are solved by `delivery: "caller"`; the root stays
  idle, but a future DSH release must be re-checked because the settlement
  behavior is internal.
- **Route/model** is not source-preserved by the public create path; the
  request-prefix fingerprint may differ even when preset/cwd/permissions match.
- **Permission events** must be present in the copied prefix; older sessions
  without them fall back to current defaults.
- **Team tasks** are plugin-owned; copying is straightforward, but owner ids
  must be remapped and revisions reset.
- **External nodes** are copied as placeholders, not resurrected executions.
- **Failure atomicity** spans sessions, catalogs, compositions, and tasks; the
  current storage domain has no cross-table transaction.
