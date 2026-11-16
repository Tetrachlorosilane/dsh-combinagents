/**
 * dsh-combinagents — scaffold bundle entry.
 *
 * The runtime composition service and Web UI are deliberately not wired in this
 * framework commit. This entry exists so the package has a valid DSH bundle
 * shape and can later grow a Host half without changing its identity.
 *
 * See docs/FEASIBILITY.md before implementing. The central constraint is that
 * DSH's native subagent lineage is immutable; this project composes an overlay
 * instead of rewriting it.
 */

/** Package identity used by the bundle and future Client module. */
export const name = '@dsh-external/dsh-combinagents'

/** No hard service dependency yet; the future service will inject optional DSH services. */
export const inject = []

/**
 * Activate the scaffold.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @returns {void}
 */
export function apply(ctx) {
  ctx.logger?.info?.(
    'dsh-combinagents: scaffold loaded; composition storage, routing, and UI are not implemented yet.',
  )
}
