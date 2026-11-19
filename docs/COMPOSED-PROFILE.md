# Standard-mode execution interception

**Status (2026-11-18): the `mode` switch is removed.** `dsh-combinagents` now
runs with the normal `standard`/`ptc` tool plugins mounted. It does not ship a
separate composed preset and it does not remove native delegation rows.

## How replacement works

The plugin owns `composition_task`, `team_list`, the four Team-shaped task tools
(when native Agent Teams is absent), and one execution interceptor. The Team
model/HTTP/tool contract is in [`TEAM-API.md`](TEAM-API.md):

```js
ctx.on('tools/execute', async (exec, next) => {
  if (!compositionTool(exec.name)) return next()
  return { isError: false, value: await compositionHandler(exec) }
})
```

For `list_agents`, `send_message`, `interrupt_agent`, `subagent`,
`subagent_fork`, and `wait_agent`, the **native definition is never replaced**.
The model keeps the native name, description, parameter schema, output schema,
renderer, presentation callbacks, prompt identity/guidance, concurrency
metadata, timeout, and restrictions. Only the canonical value is supplied by the
plugin; the DSH pipeline validates it against the native output schema and
renders it through the native output declaration.

This is a 1:1 model-facing interface and a replaced execution path. Unloading
the plugin removes the listener and restores the native executor without any
tool-registry mutation.

The old `composition_list_agents` / `composition_send_message` /
`composition_interrupt_agent` aliases are removed. `composition_task` remains a
legacy aggregate; `team_list` and `team_task_create/list/get/update` are also
registered when native Agent Teams is absent. Native Team tools win when that
service is mounted. These extra tools are conditional on the caller having a
composition; outside a Team the task tools use the composition board. Native `list_subagent_models` and all other unique tools are untouched.

## Fallback for legacy composed profiles

A legacy composed preset removes the native delegation rows. Since there is no
native definition to intercept, the plugin installs static fallback definitions
in `agent.ctx` for the six names. When the native definitions appear, the
fallbacks are disposed. In a standard profile the fallback path is not used.
This keeps an old session usable while the profile is being migrated, but it is
not the 1:1 native copy.

## Required profile shape

Keep the native delegation plugins mounted:

- `tool-subagent-control`
- `tool-subagent`
- `tool-subagent-fork`

Remove `mode` from the plugin profile entry and use `standard` as the default:

```yaml
- id: dsh-combinagents
  config:
    autoGrantDelegatedEdges: true
  disabled: false

- id: agent-preset-registry
  config:
    default: standard
```

Restart the Host and open a **new standard session**. Existing sessions created
under the old composed preset keep that preset; they get fallback definitions.

## Semantics

- Nodes carry the native lifecycle `mode` (`continuable`, `one-shot`,
  `external`, `unknown`). Legacy records without it fall back from `kind/source`.
- `list_agents` returns the native-shaped array `{ name, status, description? }`.
  `name` is the composition label; `status` is `running` / `inactive`;
  `description` includes `mode=...`. One-shot and external rows are omitted,
  matching native continuable listing; one-shot follow-ups are rejected.
- `send_message` and `interrupt_agent` use the composition edge path and grants.
  Same-native-tree targets prefer the native relay; live cross-tree targets use
  the composition relay. Messages additionally allow the composition root and
  existing native-tree ancestry, without a per-message workspace approval;
  native-tree cold targets use the native subagent cold-restore path;
  cross-workspace interrupts use the approval gate. This deliberately replaces
  the native-tree-only authority; it is the merged design.
- `subagent` / `subagent_fork` start a native activation, mirror the child into
  the composition, and auto-grant the delegation edge. `agent_preset` is
  forwarded when the native schema exposes it; a plugin-level default can be set
  with `agentPreset`.
- `wait_agent` keeps the native timeout/output contract and adds same-call input
  de-duplication.
- `composition_task` remains the plugin-owned aggregate board and lists only
  tasks without a Team; the four Team-shaped tools resolve the caller's
  connected Team scope (or the composition board outside a Team), accept an
  optional `team` id/label, and never write native Team state. `team_list`
  exposes Team ids/labels/members; the composition root can administer all
  Teams. Native Agent Teams, when mounted, keeps its own tools and task state.
- The tab has a "show one-shot agents" checkbox, off by default; one-shot nodes
  are filtered from the tree, with any continuable descendants promoted.

## Compatibility and limits

- Interception applies only when the current definition is the observed native
  definition or this plugin's fallback. Another plugin's scoped same-name tool is
  left alone and executes normally.
- The native tool must be visible to the agent. A tool hidden by
  `tools.restrict` stays hidden; no fallback or interceptor target is installed.
- If a native definition is missing at first call and later appears, the
  fallback is removed on `tools/change`.
- The composition-aware tools still return `NOT_IN_COMPOSITION` when the caller
  has no composition; `subagent` creates one for a top-level caller.
- Labels are the model-facing `name`; duplicate labels are ambiguous.
- `composition_task`, `team_list`, and the Team-shaped task tools are extra
  tools and therefore change the tool catalog relative to a pure native session;
  they are exposed only when the caller belongs to a composition. The six
  delegated tools do not change the catalog.

## Verification

Open a new standard session and confirm:

1. the tool list contains the six native names plus `composition_task`,
   `team_list`, and the Team-shaped task tools when native Team is absent and
   the caller has a composition;
2. the six descriptions/parameters are the native ones;
3. `subagent` creates a composition child and an auto-granted edge;
4. `list_agents` returns the composition names/status;
5. disabling the plugin leaves the native tools and removes the plugin task tools;
6. the legacy composed session still gets fallback tools and no aliases.
