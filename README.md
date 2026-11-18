# dsh-combinagents

**English** | [简体中文](README.zh.md)

[![dsh-plugin topic](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)

A user-owned **reporting composition** for DSH (DeepSeek Harness) agents and
subagents.

DSH already gives each subagent a fixed native parent. This plugin adds a
separate, editable layer on top: you decide who reports to whom, independently
of the native subagent tree. The composition is an overlay. The plugin does not
move a session, rewrite its native parent, change its workspace, or change its
sandbox or permission policy.

> **Compatibility:** DSH `0.2.2-rc.5` on the desktop/web profile. This is an
> unpublished local plugin bundle, not an npm package to install from a
> registry. Node.js 22 or newer is required.

Part of the [dsh-plugin](https://github.com/topics/dsh-plugin) topic.

## What you get

- A right-sidebar **Agent composition** tab.
- A separate count chip in the session header.
- Add local sessions or external agents, rename nodes, and set **Reports to**.
- Per-edge **message** and **interrupt** grants.
- Automatic mirroring when a subagent starts.
- **Sync native agents** to import native descendants.
- Clone a whole team, or bud one node into a new independent root.
- A plugin-owned task board, separate from DSH Team.
- Native-name model tools that use the composition, while keeping the native
  tool schemas.
- Cross-profile convergence: another DSH profile's edit becomes visible without
  restarting the Host.

## What it does not do

- It does **not** re-parent existing DSH sessions natively.
- It does **not** delete or rewrite DSH sessions when you remove nodes.
- It does **not** widen a sandbox, permission preset, or approval policy.
- It does **not** merge sessions or move a session to another workspace.
- It is **not** a cross-host or multi-user service. It is a local-profile
  feature.

Think of it as an editable organization chart beside the native subagent tree,
not a replacement for that tree.

## Requirements

- DSH `0.2.2-rc.5` with the desktop/web UI.
- Node.js 22 or newer.
- A **standard** DSH profile (or another preset that keeps the native
  delegation plugins mounted):
  - `tool-subagent-control`
  - `tool-subagent`
  - `tool-subagent-fork`
- The profile must expose `sessions`, `storageDomain`, `subagents`, and the
  sidebar-right client UI. Missing optional services degrade individual fields,
  not the whole tab.

The plugin can run beside other tool plugins. It keeps the native tool
definitions; it only intercepts execution for the six names listed below.

## Install

This checkout is a DSH **bundle** (`package.json` has a `dsh.bundle.patch`
entry). It is not published to npm.

1. Put the checkout in a stable local directory.
2. Register it in your DSH profile as a local bundle. Use the DSH Plugin Manager
   bundle installation for your DSH version, or the equivalent local package
   link in the profile.
3. Make sure the profile entry is enabled:

```yaml
- id: dsh-combinagents
  config:
    autoGrantDelegatedEdges: true
  disabled: false
```

4. Keep the native delegation plugins mounted. Do **not** use the legacy
   `composed` preset that removes them; without the native definitions there is
   nothing for the plugin to intercept.
5. Restart the Host and refresh the GUI.

After a Host restart, open a **standard** session. Existing sessions created
under an older composed preset keep their old preset until you move them; they
receive a compatibility fallback, but a new standard session is recommended.

If the tab or header chip is missing, confirm the plugin is enabled in the
profile and refresh the page after the Host restart.

## Quick start

1. Open a normal standard session.
2. Open **Agent composition** from the right sidebar or the header chip.
3. Click **Create composition** if this session has no composition yet.
4. Click **Add a session** and select another session. Set its **Reports to**
   parent, or leave it as a root.
5. Open **Details** on an edge to allow messages or interrupts across that
   edge. New manual connections allow messages by default; interrupts stay off
   until enabled.
6. Start a subagent normally with `subagent` or `subagent_fork`. It is mirrored
   into the composition automatically, with its native parent and an
   auto-granted delegation edge.
7. Use **Sync native agents** if a native descendant is missing.

A session belongs to at most one composition. If you attach a session that is
already in another composition, its subtree moves; a remaining source forest is
re-keyed to another local root. The moved subtree keeps its internal grants, and
a new boundary edge inherits the previous incoming grant, so an explicit deny
stays denied. An ordinary DSH fork is a new root; it does not inherit
composition membership from its `parentSession` header.

## The tab

| Action | What it does |
|---|---|
| Add a session | Add an existing DSH session as a composition node |
| Add external | Add a placeholder for an external/non-local execution |
| Reports to | Set the node's parent; `No parent` makes it a root |
| Rename | Change the node label (not the DSH session title) |
| Message / Interrupt grants | Allow that action along the composition path |
| Sync native agents | Import native descendants that are not mirrored yet |
| Clone whole tree | Create a new independent tree; source stays unchanged |
| Bud as new root | Clone one node and its subtree as a new root |
| Show one-shot agents | Show one-shot nodes that are hidden by default |
| Composition tasks | Create, start, complete, reopen, and delete plugin tasks |
| Open conversation | Open a local session; external nodes never offer it |

Nodes show `live`, `saved`, or `archived` state, plus the native parent,
workspace, sandbox, permission preset, agent preset, and lifecycle mode when
available.

The tab filters **one-shot** nodes by default. Enable **Show one-shot agents**
to see them. External nodes remain visible because they are placeholders, not
necessarily one-shot agents.

## Model tools

The plugin does not register shadow copies of the native tools. It registers a
`tools/execute` interceptor. For these six names, the native definition and
therefore the model-facing name, description, parameters, output schema,
presentation, prompt guidance, and restrictions stay unchanged; only the
execution path uses the composition:

| Tool | In this plugin |
|---|---|
| `list_agents` | Lists continuable composition nodes, with `mode=` in the description |
| `send_message` | Follows composition edges and grants; rejects one-shot targets |
| `interrupt_agent` | Follows composition ancestor/grant rules; can interrupt live one-shot agents |
| `subagent` | Starts a native child, mirrors it, and auto-grants the edge |
| `subagent_fork` | Same as `subagent`, using the fork provider |
| `wait_agent` | Native caller-inbox wait behavior |

`composition_task` is the only globally registered extra tool. The old
`composition_list_agents`, `composition_send_message`, and
`composition_interrupt_agent` aliases are removed. Native
`list_subagent_models` and other unique tools are untouched.

`list_agents` omits **one-shot** and **external** rows, matching the native
continuable listing. One-shot targets cannot receive follow-ups. The lifecycle
mode is shown in the row description because the native output schema does not
have a separate `mode` field.

### Lifecycle modes

Composition nodes carry the same native lifecycle distinction:

| Mode | Meaning |
|---|---|
| `continuable` | A long-lived child that can receive follow-up messages |
| `one-shot` | A terminal execution with no follow-up |
| `external` | An external execution with no local session |
| `unknown` | A legacy or not-yet-synced record |

A name is not a lifecycle mode. A child without an explicit name still gets a
generated `agent-N` name and can still be continuable. Use **Sync native agents**
to refresh modes from the native catalogs.

## Cross-profile consistency

The storages live under the DSH home, so two profiles can open the same
composition data. Each Host keeps its own in-memory storage-domain snapshot.
The plugin makes them converge:

- After a durable composition or policy write, a small `.revision` marker is
  updated.
- A reader that sees a newer marker reopens the storage domain and rebuilds
  session membership.
- Composition mutations take a process-shared `.mutation.lock`, so two profiles
  do not overwrite each other's read-modify-write.
- The tab polls `/state` every 3 seconds and the header chip polls `/summary`
  every 5 seconds while visible.

This is **eventual convergence**, not a synchronous distributed database.
Writes from an older plugin version do not publish the marker, and a custom
storage backend outside the default directory needs a `storageDir` override.

## Safety and authority

- The overlay never writes a DSH `SessionHeader`, native `subagent/catalog`,
  cwd, sandbox policy, or permission preset.
- Composition edges are advisory for organization. The plugin's `send_message`
  and `interrupt_agent` execution use composition grants; they do not bypass
  native session policy.
- Messages prefer the native relay inside a native tree. Live cross-tree
  targets use the composition relay.
- Crossing workspaces without full permission asks the approval service; only
  an accepted one-shot approval proceeds.
- Every delivered, denied, or approval-denied action is audited.
- External nodes cannot receive follow-ups.
- Removing a node removes only the overlay. It never deletes a DSH session.

## Troubleshooting

| Symptom | Check |
|---|---|
| The six native-name tools still behave natively | Is the plugin enabled? Does the profile keep the native delegation rows? Restart the Host after installing. |
| `composition_*` tools are missing | They were removed by design; use the native names plus `composition_task`. |
| `NOT_IN_COMPOSITION` | Create a composition for this session, or use `subagent` from a top-level agent. |
| `AGENT_BUSY` | An affected agent or one of its composition ancestors/descendants is running. Wait for it to finish. |
| `another DSH profile is changing the composition` | Another profile holds the mutation lock. Retry after a moment. |
| `STORAGE_UNAVAILABLE` | The domain could not be reloaded; reads keep the last in-memory snapshot and writes fail closed. Restart the Host. |
| `storageMemory` warning | The storage domain could not open. Changes last until the Host restarts; check the DSH storage backend. |
| A one-shot agent is missing | It is hidden by default. Enable **Show one-shot agents**; use **Sync native agents** if its mode is still unknown. |
| The tree looks stale in another profile | Wait for the 3-second poll, refresh the page, or check that both profiles run this version. |
| The tab is absent | Confirm the plugin and client UI are enabled, then refresh after the Host restart. |

## Limitations

- One composition per session, and a strict `reports-to` forest.
- No native re-parenting and no merging of sessions.
- Labels are user-facing and may be duplicated; duplicate labels make
  `send_message` target selection ambiguous.
- The plugin does not change a session's workspace, sandbox, permission preset,
  or approval policy.
- Task-board state is plugin-owned, not DSH Team state.
- A very large archived composition under an enormous transcript can still make
  the surrounding session UI paint slowly; the bridge itself is not the
  bottleneck.
- Legacy composed sessions use fallback tool definitions until they migrate to
  a standard preset.
- The exact native request-prefix fingerprint is not part of the acceptance
  tests yet.

## Development

```bash
npm test
npm run check
```

Tests use only Node's built-in test runner. There is no build step and no
runtime dependency.

```text
index.js                 Host entry and bridge lifecycle
client.js                Right-sidebar tab, header utility, count chip
src/graph.js             Pure composition graph
src/clone.js             Pure clone/bud planner
src/clone-manager.js     Clone/bud host adapter
src/store.js             Storage domain, revision reload, mutation lock
src/discovery.js         Session and native-catalog discovery
src/manager.js           Serialized mutations and grants
src/http.js              Loopback JSON bridge
src/controls.js          Native tool execution interception
```

More detail:

- [Architecture](docs/ARCHITECTURE.md)
- [Product handoff](docs/HANDOFF.md)
- [DSH feasibility notes](docs/FEASIBILITY.md)
- [Standard-profile setup and migration](docs/COMPOSED-PROFILE.md)
- [Clone/bud spike](docs/CLONE-SPIKE.md)
- [Working contract for contributors](AGENTS.md)

## License

MIT. See [LICENSE](LICENSE).
