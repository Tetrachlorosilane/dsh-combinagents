# Feasibility: recombining DSH agents without changing their workspaces or permissions

**Reviewed against:** DSH `0.2.2-rc.3` (Windows Desktop, packaged `app.asar`).
**Scope of this document:** whether a DSH plugin can give multiple agents and
subagents a new reporting composition while preserving each one's own
workspace, sandbox mode, approval policy, and tool composition.

This is a design review, not a promise of behavior. The repository now
implements the phase-1 overlay, discovery, durable storage, and control-tool
surface; clone/bud remain future work. For the authoritative product
requirements, clone/bridge/bud logic, cache rules, and UI handoff, read
[`HANDOFF.md`](HANDOFF.md); this document remains the source review behind it.

## 1. Short answer

There are two different things a user can mean by "recombine the reporting
relationships":

1. **Rewrite DSH's native lineage** — change who a session's real parent is,
   move it into another subagent tree, and make the standard `send_message`,
   `interrupt_agent`, Team task board, archive admission, and subagent header
   catalog follow the new edge.
2. **Add a separate reporting composition** — keep DSH's native lineage
   untouched and record a user-owned overlay: "in this composition, reviewer
   reports to planner, even though DSH created reviewer under lead."

**Only the second is feasible in a plugin.** The first would have to be a DSH
core feature because the parent identity, the parent-owned catalog, the live
activation ancestry, and the authority checks that depend on them are all
immutable or owned by packages outside a plugin.

The second also has an important honesty requirement: an overlay edge is a
**coordination intention**, not native authority. It must not silently make the
standard `send_message` tool work across trees or change which workspace a
session writes to. Those are separate capabilities with separate security
consequences.

## 2. What "same or different sources" means in DSH

DSH already has several agent origins. They do not share one uniform
"agent" object.

| Source | Durable local session? | Native parent | Roots / tree | Follow-up input |
|---|---|---|---|---|
| Top-level session | Yes | none | its own root | ordinary UI prompt |
| In-process `spawn` child | Yes | creator session | creator's tree | yes (`send_message`, browser) |
| In-process `fork` child | Yes, seeded prefix | creator session | creator's tree | yes |
| External backend (ACP, SDK, Codex, Claude Code) | Usually no local child session | cataloged under creator | creator's tree as leaf | no; one execution |
| Ordinary `ctx.sessions.fork()` | Yes | historically may record source | **new** tree (`origin` absent) | normal top-level prompt |
| Workflow caller-delivery child | Local or external depending on backend | creator/caller | may be caller-owned, not parent cataloged | varies |

Relevant facts:

- `SessionHeader.parentSession` records a subagent's direct creator; ordinary
  forks may retain the source there, so classification must use `origin`
  (`@deepseek-ai/dsh-session/src/types.ts`, `SessionHeader`;
  `dsh-session/README.md`).
- `subagent/catalog` is a **parent-owned** append-only event. There is no public
  "remove child" or "change child parent" operation
  (`@deepseek-ai/dsh-subagent/src/catalog.ts`).
- External children are catalog entries with `mode: 'external'` and no local
  Session. They are intentionally leaves
  (`@deepseek-ai/dsh-subagent/README.md`; `src/catalog.ts`).
- A composition UI should therefore show a **source badge** (`top-level`,
  `spawn`, `fork`, `external`, `unknown`) and the **native parent** separately
  from the overlay parent.

## 3. Why native re-parenting is not a plugin feature

### 3.1 The session header is immutable

`SessionHeader` exposes `parentSession`, `origin`, `delegationDepth`, `cwd`, and
`agentPreset` as `readonly` fields
(`@deepseek-ai/dsh-session/src/types.ts`). The only supported working-directory
change is `workingDirectory.set()`, which appends a
`working-directory/change` event and explicitly does **not** change existing
processes or permissions. There is no public setter for `parentSession`.

A plugin could technically construct a new `Session` with arbitrary metadata
through `ctx.sessions.prepare/create`, because `CreateSessionOptions.meta`
accepts `parentSession`. That is not re-parenting an existing session: it
creates a new one. More importantly, it does not create the runtime ownership
that native tree operations require (next section).

### 3.2 Native tree access is activation-owned, not just metadata

`SubagentManager.rootOf()` resolves a root through the live Activation record,
or treats an ordinary top-level Agent as its own root. For a session whose
header says `origin: 'subagent'` but which has no live Activation, it throws
`UNAUTHORIZED` ("agent has no active runtime owner")
(`@deepseek-ai/dsh-subagent/src/manager.ts`, `rootOf`).

Cold delivery and cold resume walk the **creation ancestry**: the target's
`parentSession`, the parent's catalog entry for the target, and so on. A missing
catalog entry rejects with "subagent is absent from its creator catalog"
(`manager.ts`, `resolveCreationAncestry`). So writing a different
`parentSession` into a new header would not be enough; the new parent would
also need a matching catalog record, and the old records would still exist.

### 3.3 Messaging authority follows the native tree

`ctx.subagents.sendMessage()` resolves the sender's root, then delivers only to
a member of that tree. `startActivation()` requires the exact live parent and
creates a new child; it has no "attach existing session" branch
(`@deepseek-ai/dsh-subagent/src/index.ts`, `startActivation`, `sendMessage`).
The model-facing `send_message` tool documents the same rule: targets must be
the root or a reachable continuable member of the caller's tree
(`@deepseek-ai/dsh-tool-subagent-control/README.md`).

### 3.4 Team and archive behavior also follow the native tree

- Agent Teams are explicitly one tree with a shared checkout; members cannot
  message unrelated Teams (`@deepseek-ai/dsh-agent-team/README.md`, "Known
  Limitations").
- Archive admission for subagents uses managed creation ancestors. Re-parenting
  would change which root can cancel or admit work
  (`@deepseek-ai/dsh-subagent/src/archive-admission.ts` and
  `manager.ts`).
- The subagent header UI reads parent-owned catalogs, not `parentSession`
  alone; it will not display a fabricated edge
  (`@deepseek-ai/dsh-client-ui-subagent/README.md`).

### 3.5 A re-parent operation would be a security boundary

Native tree membership authorizes messaging and ancestor interruption. Moving a
session under a different root would grant that new root authority over it. That
is not a cosmetic edit. If DSH ever supports it, it needs an explicit,
auditable core operation with user consent, not a plugin writing log events.

**Verdict:** true re-parenting of existing sessions is **not feasible** as a
third-party plugin on `0.2.2-rc.3`.

## 4. What is feasible

### Option A — Overlay composition (recommended)

Store a plugin-owned graph of nodes (sessions and external placeholders) and
`reports-to` edges. Never touch the sessions themselves.

**Preserves workspace and permissions by construction.** The plugin only reads:

- `session.header.cwd` and `workingDirectory.get(session)` for display;
- `sandboxPolicy.resolve({ session })` for the effective mode and roots;
- `permissionPresets.current(session)` and the approval policy for display;
- `session.parentSession`, `origin`, `delegationDepth`, and catalog rows for
  native-lineage badges.

It writes none of them. A graph edit cannot widen a sandbox, change an approval
policy, or move a process. This is the cleanest security story.

**Discovery** is available:

- `ctx.agents.list()` for live agents;
- `ctx.sessions.list()` for live sessions;
- `ctx.sessionQuery.listSessions()` for the complete live-plus-persisted corpus
  with `SessionRecord.live`, `header.cwd`, `parentSession`, and `origin`;
- `ctx.subagents.listDescendants(rootSessionId)` for native catalogs, including
  external leaves.

**What it does not do:** it does not make `send_message`, `interrupt_agent`, or
Team task assignment follow the overlay. Those remain native-tree operations.
That must be stated in the UI and docs.

### Option B — New native composition (new agents only)

A plugin can build a new native subagent tree: create a root or use an existing
root, then start new children with `ctx.subagents.startActivation()` or the
standard `subagent` tool. Per-child `cwd` and `agentPreset` are supported; child
model options are supported when the provider advertises them.

This **cannot attach an existing session**. It creates new sessions. A fork
backend can seed a new child with another session's completed history, but the
result is a new session id with a new parent, not the original agent.

There is also a permission limitation: the manager captures the **parent's**
sandbox override, permission preset (only `auto` or `danger-full-access`), and
pins approval to `never`; it does not copy a different source session's policy
(`@deepseek-ai/dsh-subagent/src/child-agent.ts`,
`captureDelegatedPolicyOverrides`, `appendDelegatedPolicyOverrides`). New
children therefore inherit the parent's policy, not an arbitrary source's. A
plugin could change the child's preset afterward through
`permissionPresets.set()`, but that is a deliberate policy write, not
"preserving" the source, and must be treated as a separate, audited feature.

### Option C — Clone or materialize a source session

A plugin can create a **new** native child seeded from a source log, with a
chosen `cwd` and preset, under a chosen live parent. This preserves a snapshot
of workspace and history, but not identity, not the original session's live
processes, and not an independent permission policy unless the policy is
re-applied. This is a useful "materialize the chart" action later; it should
be labeled as a clone, never as attaching the original.

### Option D — Cross-tree message routing in the overlay

For **live local** sessions, a plugin can call `agent.followup()` or
`agent.steer()` directly. For cold persisted local sessions it can call
`ctx.agents.resume()` and then deliver, but the plugin then owns the returned
`AgentHandle` and must manage its lifetime. External executions have no local
session and cannot receive follow-ups.

This is technically possible but changes the security model: an overlay edge
would grant one agent the ability to inject input into another agent outside its
native tree. It needs explicit user opt-in per edge, audit records, and careful
handling of cold resume ownership. It is **not** part of phase 1.

## 5. Comparison

| Approach | Attaches existing sessions | Keeps each workspace | Keeps each permission policy | Native `send_message` follows new edge | Plugin-only |
|---|---|---|---|---|---|
| Rewrite header + catalog | Intended | Yes | Yes | Would require core changes | **No** |
| Overlay graph | Yes | Yes | Yes | No | **Yes** |
| New native tree | No, creates new | Per-child `cwd` supported | Child inherits parent, not source | Yes, within the new tree | Yes |
| Fork/materialize clone | No, creates new | Yes, snapshot | Not automatically source's | Yes, within new tree | Yes |
| Overlay + direct inbox routing | Yes | Yes | Yes (untouched) | No, custom route | Yes, with new authority |
| DSH core re-parent feature | Yes | Yes | Yes | Yes | Core change |

## 6. Recommended shape for phase 1

The original recommendation was an **overlay editor with no model-facing
tools**. The implemented phase 1 keeps the overlay but adds three **static**
composition control tools (and an opt-in composed surface), per `HANDOFF.md`
R8. It adds no dynamic prompt or tool text in overlay mode, and it still never
mutates session headers, cwd, sandbox policy, or approval policy.

- one right-sidebar tab (or a tab that can go fullscreen) for the composition;
- nodes discovered from live/persisted sessions, with source and native-parent
  badges;
- editable `reports-to` forest with cycle and duplicate checks;
- clear labels for workspace, effective sandbox mode, permission preset, and
  "native parent" versus "composition parent";
- no dynamic model tools and no dynamic prompt injection; the static control
  tools are documented in [`ARCHITECTURE.md`](ARCHITECTURE.md#7-model-surface);
- no mutation of session headers, cwd, sandbox policy, or approval policy;
- no claim that the overlay changes native messaging authority.

This gives users the organizational view they asked for while preserving the
exact per-agent permissions DSH already enforces.

## 7. Phase 2 options, in order of risk

1. **Read-only enrichment** — show native catalogs, external leaves, live
   status, token usage, and current working directory.
2. **Composition-scoped notes** — store user notes on edges, still no routing.
3. **Opt-in direct routing** — one explicit edge capability, live local sessions
   only; audit every delivery; never reuse native `send_message` authority.
4. **Materialize new native children** — create a new tree from the chart with
   per-node `cwd`/preset, clearly labeled as new agents; do not copy permissions
   silently.
5. **Core-assisted true re-parenting** — only if DSH exposes an audited
   operation later.

## 8. Open questions to settle before implementation

1. Is a composition owned by one **root session**, one **workspace**, or the
   whole profile?
2. May one session appear in more than one composition? If yes, which
   composition wins when they conflict?
3. Is the graph a strict forest (recommended) or a DAG with multiple managers?
4. Do users need external/one-shot agents as visible-but-unroutable leaves?
5. Should the graph ever be shown to the model (prompt context), or remain a
   human-only view?
6. If routing is added, is each edge a capability grant, or is there one global
   "allow cross-tree messages" switch?

## 9. Source map used for this review

- `@deepseek-ai/dsh-session/src/types.ts` — `SessionHeader` immutability,
  `parentSession`, `origin`, `delegationDepth`.
- `@deepseek-ai/dsh-session/README.md` — parentSession semantics, forks, "no
  session tree beyond fork".
- `@deepseek-ai/dsh-agent/src/index.ts` — `CreateAgentOptions.meta`, factory
  ownership, lifecycle.
- `@deepseek-ai/dsh-subagent/src/index.ts` — provider registry,
  `startActivation`, `rootOf`, `sendMessage`, `listDescendants`.
- `@deepseek-ai/dsh-subagent/src/manager.ts` — local/external creation,
  `rootOf`, `resolveCreationAncestry`, `sendMessage`, cold resume.
- `@deepseek-ai/dsh-subagent/src/child-agent.ts` — child metadata, inherited
  cwd, delegated policy capture.
- `@deepseek-ai/dsh-subagent/src/catalog.ts` — parent-owned catalog events.
- `@deepseek-ai/dsh-agent-team/README.md` — one-tree Team model and shared
  checkout limitation.
- `@deepseek-ai/dsh-tool-subagent-control/README.md` — same-tree messaging and
  interruption authority.
- `@deepseek-ai/dsh-client-ui-subagent/README.md` — catalog-driven navigation.
- `@deepseek-ai/dsh-subagent-spawn-in-process/README.md` and
  `@deepseek-ai/dsh-subagent-fork-in-process/README.md` — new-child semantics.
- `ctx.sandboxPolicy`, `ctx.workingDirectory`, `ctx.permissionPresets`,
  `ctx.sessionQuery` service contracts inspected in the running Host.
