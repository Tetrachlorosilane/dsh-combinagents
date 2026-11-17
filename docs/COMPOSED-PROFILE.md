# Composed profile overlay

`mode: 'composed'` registers the native-name tool surface and restores the
native subagent prompt sections. It must not run beside the native subagent
control/delegation tools, because both would register `list_agents`,
`send_message`, `interrupt_agent`, `subagent`, `subagent_fork`, and
`wait_agent`.

## Strategy (2026-11-17)

The composed preset is a **copy of the installed `standard` preset's plugin
list**, with exactly the native delegation rows the composed surface replaces
removed:

- `tool-subagent-control` — registers `list_agents`, `send_message`,
  `interrupt_agent`, and `wait_agent`;
- `tool-subagent` — the `spawn` row that registers `subagent`;
- `tool-subagent-fork` — the `fork` row that registers `subagent_fork`.

Every other standard group and tool is retained: planning/plan mode,
compaction plus the tool-result pruner, workflow (`workflow-ptc` and
`tool-workflow`), skills, schedule, goals, office, jobs, web, present, todo,
ask-user, and the plugin manager/market rows. The composed plugin supplies the
six native-name tools plus `composition_task` and the `composition_*` aliases.

Do **not** delete the whole `delegation` group to remove the replaced tools.
That also drops `workflow-ptc`/`tool-workflow`, which composed mode does not
replace. Disable or omit only the three rows above.

Do not rebuild composed from the older hand-maintained subset. A subset loses
standard tools (schedule, skills, goals, plan mode, office, plugin manager) and
the compaction group, which is how the missing `/compact` incident below
happened.

**Status:** the desktop profile has the mirrored preset on disk (2026-11-17);
a Host restart is required before new composed sessions mount it. Existing
composed sessions keep the composition they were created with. The previous
composed surface was loaded and verified: it exposed the native-name tools plus
the unshadowed `composition_*` aliases and the compatibility prompt; the GUI
showed the shipped `subagent-catalog` entry and the `dsh-combinagents-count` chip
together; the composed chain (start → child edge → wait → follow-up → wait →
interrupt) passed in a clean headless profile and in live desktop message
checks. Re-run the tool-list and `/compact` checks after the restart.

The desktop profile mounts those native tools inside the agent-preset
`delegation` group, so a top-level `- id: tool-subagent` patch cannot disable
them. Use a composed agent preset that keeps the group and omits only the three
replaced rows.

## Incident: missing `/compact` (2026-11-17)

- **Symptom:** a composed session had no `/compact` command, while the plugin
  code and the desktop bundle were otherwise healthy.
- **Root cause:** the composed preset was a hand-maintained subset and omitted
  the `compaction` group. The shipped desktop bundle disables the host-level
  `compaction-basic`/`command-compact` rows, so only a preset that mounts the
  group registers `ctx.compaction` and the command.
- **Fix:** the profile preset now carries the full standard `compaction` group
  (`compaction-basic`, `command-compact`, and
  `compaction-tool-result-pruner`, with `isolate: { compaction: true,
  toolResultPruner: true }`). The profile was backed up before the change as
  `cordis.patch.yml.bak-compact-20261117-2320`; the preset-mirror change has its
  own backup `cordis.patch.yml.bak-composed-standard-20261117-2331`.
- **Scope:** profile configuration only. No DSH source and no plugin source
  changed for this incident.
- **Verification:** restart the Host, open a new composed session, and confirm
  `/compact` is listed and accepted.
- **Lesson:** a composed preset must carry every standard group it wants,
  including compaction; the desktop bundle does not provide it at host level.

## Apply

Append this to the **profile** `cordis.patch.yml` (for the desktop profile:
`$DSH_HOME/profiles/desktop/cordis.patch.yml`), then restart the Host. In a
profile patch the preset's `skill-filesystem` custom directory cannot use the
bundle's `baseUrl`; resolve the shipped preset skills through
`DSH_INSTALL_DIR` instead, as below. If that variable is absent, the expression
yields no custom directory and the default project/user roots still work.

```yaml
# ---- composed mode test/profile overlay ----
- id: dsh-combinagents
  config:
    mode: composed
    autoGrantDelegatedEdges: true

# Optional: make composed the default for new sessions.
- id: agent-preset-registry
  config:
    default: composed

- insert:
    - id: preset-composed
      name: "@deepseek-ai/dsh-agent-preset"
      config:
        id: composed
        order: 0
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: You are a coding agent powered by the {{model}} model.
          - id: agent-instructions
            name: '@deepseek-ai/dsh-agent-instructions'
            config:
              maxBytes: 65536
          - id: time-context
            name: '@deepseek-ai/dsh-time-context'
          - id: tool-bash
            name: '@deepseek-ai/dsh-tool-bash'
            disabled: !!js process.platform === 'win32'
          - id: tool-pwsh
            name: '@deepseek-ai/dsh-tool-pwsh'
            disabled: !!js process.platform !== 'win32'
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
            config:
              # Set false to drop the apply_patch tool beside edit.
              applyPatch: false
          - id: tool-fs-search
            name: '@deepseek-ai/dsh-tool-fs-search'
            config:
              sampleOverCapGlobResults: false
          - id: tool-jobs
            name: '@deepseek-ai/dsh-tool-jobs'
          - id: tool-schedule
            name: '@deepseek-ai/dsh-tool-schedule'
          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'
            config:
              customSkillDirs:
                - !!js "process.env.DSH_INSTALL_DIR ? [process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:path').dirname(process.env.DSH_INSTALL_DIR), 'dsh-agent-preset', 'skills')] : []"
          - id: tool-skill
            name: '@deepseek-ai/dsh-tool-skill'
          - id: command-goal
            name: '@deepseek-ai/dsh-command-goal'
          - id: tool-goal
            name: '@deepseek-ai/dsh-tool-goal'
          - id: planning
            name: cordis:group
            group: true
            isolate:
              planMode: true
            config:
              - id: plan-mode
                name: '@deepseek-ai/dsh-plan-mode'
                config:
                  section: |
                    You are in plan mode. Stay in plan mode until the user approves your plan through exit_plan_mode or switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

                    Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

                    The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.

                    Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

                    Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.

                    When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.
          - id: compaction
            name: cordis:group
            group: true
            isolate:
              compaction: true
              toolResultPruner: true
            config:
              - id: compaction-basic
                name: '@deepseek-ai/dsh-compaction-basic'
              - id: command-compact
                name: '@deepseek-ai/dsh-command-compact'
              - id: tool-result-pruner
                name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
                config:
                  thresholdChars: 8192
                  headChars: 4096
                  tailChars: 1024
          - id: delegation
            name: cordis:group
            group: true
            isolate:
              workflowEngine: true
            config:
              - id: workflow-ptc
                name: '@deepseek-ai/dsh-workflow-ptc'
                config:
                  provider: spawn
              - id: tool-workflow
                name: '@deepseek-ai/dsh-tool-workflow'
          - id: tool-ask-user
            name: '@deepseek-ai/dsh-tool-ask-user'
          - id: tool-todo
            name: '@deepseek-ai/dsh-tool-todo'
            config:
              allowParallelInProgress: true
          - id: tool-web
            name: '@deepseek-ai/dsh-tool-web'
            config:
              fetch: true
              searchTimeoutMs: 60000
          - id: present
            name: '@deepseek-ai/dsh-tool-present'
          - id: tool-office
            name: '@deepseek-ai/dsh-tool-office'
          - id: tool-plugin-manager
            name: '@deepseek-ai/dsh-plugin-manager/tools'
            disabled: !!js "!ctx.get('profileContext')"
          - id: tool-plugin-market
            name: '@deepseek-ai/dsh-plugin-market/tools'
            disabled: true
```

## Verify

1. Open a session with the `composed` preset.
2. Ask for the available tools. It should expose the composed names
   (`list_agents`, `send_message`, `interrupt_agent`, `subagent`,
   `subagent_fork`, `wait_agent`, `composition_task`) plus the standard
   non-delegation tools: plan mode (`exit_plan_mode`), workflow, skills,
   schedule, goals, office, jobs, web, present, todo, ask-user, and the plugin
   manager, with no duplicate native registration error.
3. Confirm `/compact` is available.
4. Start a subagent, list the composition, send it a follow-up, wait, and
   interrupt it.
5. The composition tab should show the child node and the auto-granted
   message/interrupt edge.

Changes to an agent preset affect **new** sessions; an existing session keeps
the composition it was created with until it is resumed under the new
definition or a new session is started.

## Known gaps

- The native spawn row also registered `list_subagent_models` when
  `modelDiscovery` was on. Composed mode does not expose that separate helper;
  the composed `subagent` tool validates and forwards explicit
  `provider`/`model`/`reasoning_effort` itself but does not list models. This is
  tied to removing the `tool-subagent` row, not to the other standard tools.
- Tool order and the exact model-prefix fingerprint have not been compared with
  a live native request.
- The composed `subagent` tool does not enforce the desktop subagent
  model-selection allowlist; it only requires a resolvable route.
- The native `subagent`/`subagent_fork`/`control` tools are disabled only for
  sessions using this preset; a session on `standard`/`ptc` still mounts the
  native tools and shadows the composed names.
- A very large session transcript can delay the composition tab's paint even
  though the bridge responds quickly; this is not specific to composed mode.
