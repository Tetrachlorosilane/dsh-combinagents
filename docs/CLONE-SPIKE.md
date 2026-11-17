# Clone / Bud spike — DSH API findings

**Status:** source-level and live two-node Host spike complete against DSH
`0.2.2-rc.3`. Root clone, seeded child, native catalog entry, and the
persisted-idle child strategy all passed. The formal whole-tree adapter is
implemented in `src/clone-manager.js` with the `/clone-tree` and `/bud` routes;
live GUI re-verification is pending. A temporary `POST /clone-spike` route
remains wired for diagnostics; it is not part of the product API and must be
removed once the formal adapter is verified.

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

## 4. Temporary `/clone-spike` route

The Host exposes a temporary, token-authenticated POST route for the live spike:

```
POST /dsh-combinagents/clone-spike
{ "rootSessionId": "...", "childSessionId": "...", "mode": "dispose" | "live", "cleanup": false }
```

- It reads the source root and child prefixes via `sessionQuery.observeSession`.
- It creates one clone root via `ctx.agents.create` and, when `childSessionId`
  is supplied, one seeded child via the temporary `combinagents-clone-spike`
  provider and `startActivation`.
- `mode: "dispose"` disposes the child activation immediately after the catalog
  entry is established; `mode: "live"` leaves it running.
- The response is a diagnostic object (ok/error, headers, permissions, catalog
  counts, source-unchanged flag). It does not create a composition record.
- To dispose a retained live attempt:
  `{ "action": "cleanup", "cloneRootSessionId": "..." }`.
- The route is deliberately outside the product API and must be removed after
  the spike. The Host needs one restart to load it.

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

## 6. Live Host spike checklist

These require a debug route/tool and a Host restart; none is implemented yet.

1. Clone a two-node tree (root + one child) and verify the cloned root's
   `header.cwd`, `agentPreset`, permission preset, and native child catalog.
2. Verify the source session headers/catalogs/permissions do not change.
3. Compare the first request prefix of the clone with the source; record the
   route/model difference, if any.
4. Determine the child-idle behavior of `startActivation` + immediate
   `dispose()`; inspect whether the child remains listable, resumable, and
   messageable.
5. Clone the 16-node rich composition; measure time and failure cleanup.
6. Copy a task board with owners on both root and child nodes; verify the
   remapped owners.
7. Bud a child + subtree; verify the original node and tree remain untouched
   and both trees can delegate independently.

## 7. Risks / open items

- **Idle child semantics** are the main unknown; a clone should not silently
  run one model turn per child.
- **Route/model** is not source-preserved by the public create path; the
  request-prefix fingerprint may differ even when preset/cwd/permissions match.
- **Permission events** must be present in the copied prefix; older sessions
  without them fall back to current defaults.
- **Team tasks** are plugin-owned; copying is straightforward, but owner ids
  must be remapped and revisions reset.
- **External nodes** are copied as placeholders, not resurrected executions.
- **Failure atomicity** spans sessions, catalogs, compositions, and tasks; the
  current storage domain has no cross-table transaction.
