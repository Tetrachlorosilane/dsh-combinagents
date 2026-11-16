# Composed profile overlay

`mode: 'composed'` registers the native-name tool surface and restores the
native subagent prompt sections. It must not run beside the native subagent
control/delegation tools, because both would register `list_agents`,
`send_message`, `interrupt_agent`, `subagent`, `subagent_fork`, and
`wait_agent`.

The desktop profile mounts those native tools inside the agent-preset
`delegation` group, so a top-level `- id: tool-subagent` patch cannot disable
them. Use a composed agent preset that omits the group instead.

## Apply

Append this to the **profile** `cordis.patch.yml` (for the desktop profile:
`$DSH_HOME/profiles/desktop/cordis.patch.yml`), then restart the Host:

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
            name: "@deepseek-ai/dsh-persona"
            config:
              prefix: You are a coding agent powered by the {{model}} model.
          - id: agent-instructions
            name: "@deepseek-ai/dsh-agent-instructions"
            config:
              maxBytes: 65536
          - id: time-context
            name: "@deepseek-ai/dsh-time-context"
          - id: tool-bash
            name: "@deepseek-ai/dsh-tool-bash"
            disabled: !!js process.platform === 'win32'
          - id: tool-pwsh
            name: "@deepseek-ai/dsh-tool-pwsh"
            disabled: !!js process.platform !== 'win32'
          - id: tool-fs
            name: "@deepseek-ai/dsh-tool-fs"
            config:
              applyPatch: false
          - id: tool-fs-search
            name: "@deepseek-ai/dsh-tool-fs-search"
            config:
              sampleOverCapGlobResults: false
          - id: tool-jobs
            name: "@deepseek-ai/dsh-tool-jobs"
          - id: tool-ask-user
            name: "@deepseek-ai/dsh-tool-ask-user"
          - id: tool-todo
            name: "@deepseek-ai/dsh-tool-todo"
            config:
              allowParallelInProgress: true
          - id: present
            name: "@deepseek-ai/dsh-tool-present"
          - id: tool-web
            name: "@deepseek-ai/dsh-tool-web"
            config:
              fetch: true
              searchTimeoutMs: 60000
```

## Verify

1. Open a session with the `composed` preset.
2. Ask for the available tools; it should expose `list_agents`, `send_message`,
   `interrupt_agent`, `subagent`, `subagent_fork`, `wait_agent`, and
   `composition_task`, with no duplicate native registration error.
3. Start a subagent, list the composition, send it a follow-up, wait, and
   interrupt it.
4. The composition tab should show the child node and the auto-granted
   message/interrupt edge.

## Known gaps

- Tool order and the exact model-prefix fingerprint have not been compared with
  the native tool set.
- Explicit child `provider`/`model`/`reasoning_effort` selection is validated
  through the live LLM route and forwarded as child agent options. The composed
  tool does not enforce the desktop subagent model-selection allowlist; it only
  requires a resolvable route.
- The native `subagent`/`subagent_fork`/`control` tools are disabled only for
  sessions using this preset; a session on `standard`/`ptc` still mounts the
  native tools and shadows the composed names.
