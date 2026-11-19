# Team API and lifecycle (technical contract)

Status: current after the 2026-11-20 hardening. This document describes the
plugin-owned Team layer; it is not native DSH Agent Team state.

## 1. Model

```text
team: {
  id, rootSessionId, rootNodeId, nodeIds[],
  label, createdBy, createdAt, updatedAt
}
```

- `rootNodeId` is the Team Lead and must be a member.
- `nodeIds` is the exact member set. New Teams always store it; records created
  by older builds without it use the Lead's connected subtree.
- Members must be **local, continuable** composition nodes.
- Team labels are unique per composition.
- Team memberships must be connected and must not overlap another Team.

Teams live in the `teams` table of the `combinagents` storage domain. Tasks
carry an optional `teamId`; a Team's task board is the task set with that id.
Non-deleted tasks are capped at 256 per scope; tombstoned (`deleted`) tasks do
not consume the cap.

Team task deletion writes a tombstone: `team_task_get` can still read the
deleted snapshot, `team_task_list` excludes it, and further mutation returns
`TEAM_TASK_DELETED`. The legacy `composition_task` delete remains a hard delete
because it is not a Team task board.

## 2. Profile and tool availability

- `team_task_create`, `team_task_list`, `team_task_get`, and `team_task_update`
  are registered only when native Agent Teams service/tools are absent.
- `team_list` is registered under the same condition.
- Native Agent Teams wins when mounted; no aliases are registered.
- The extra tools are exposed only when the caller has a composition
  (`when` guard). Outside a Team the task tools use the composition board.
- `composition_task` is the legacy composition-only board; it never lists or
  updates Team-scoped tasks.

## 3. Scope and authorization

The four task tools accept an optional `team` value: a Team id or a unique
label. Omitted means "the caller's Team, otherwise the composition board."

| Caller | Read/list Team | Create task | Claim | Edit/complete/delete | Reassign |
|---|---|---|---|---|---|
| Composition root | any Team | any Team | Team members only | any Team | any Team |
| Team Lead | own Team | own Team | own Team | own Team | own Team |
| Team member | own Team | own Team | own Team | own task | no |
| Outsider | no | no | no | no | no |
| HTTP user | any Team | any Team | n/a | any Team | any Team |

`owner: "lead"` resolves to the active Team's Lead, not necessarily the
composition root. Task owners and reassignment targets must be continuable Team
members.

## 4. Graph edits

Every composition save validates all existing Teams. The edit is rejected with
`TEAM_STRUCTURE_CONFLICT` if it would:

- remove a member;
- make the selected member set disconnected;
- remove the Lead from the set; or
- make two Teams overlap.

A one-shot member is rejected with `TEAM_MEMBER_MODE`. Teams are not silently
shrunk or migrated. Delete the Team first if its membership must change.

Cross-composition moves are covered by the same check; a source Team that would
lose a moved member blocks the move and the target write is rolled back.

## 5. Revision and clone

- Task, Team, and clone writes/deletes publish the shared `.revision` marker.
- Another Host/profile therefore reloads Team and task changes on its next
  store read or UI poll.
- Clone/bud copies a Team only when all of its member nodes are included, and
  remaps the copied task `teamId` and owner node ids.
- Deleting a Team deletes its scoped tasks only; composition nodes/Sessions are
  untouched.

## 6. HTTP routes

All routes require the loopback token and exact Host/Origin checks.

| Method/path | Body/query | Result |
|---|---|---|
| `GET /teams` | `rootSessionId` | Team records |
| `POST /create-team` | `rootSessionId`, `rootNodeId`, `nodeIds?`, `label?` | Updated Team list |
| `POST /delete-team` | `rootSessionId`, `teamId` | Remaining Teams |
| `GET /tasks` | `rootSessionId`, optional `teamId` | Task rows |
| `POST /create-task` | `rootSessionId`, subject, description, optional `teamId`, owner, blockers | Updated tasks |
| `POST /update-task` | task id, revision, action, optional `teamId`, owner | Updated tasks |
| `GET /state` | session/root id | Composition, observations, Teams, tasks |

## 7. UI behavior

- The Team selector chooses the visible task board.
- The selected Team is remembered per composition in `localStorage`.
- The selected Team is a **view scope**; it does not silently change the scope
  of a model tool call. Pass `team` to use another Team from a tool.
- Team creation defaults to continuable local nodes only; external/one-shot
  nodes are never offered as members.
- The task detail panel exposes owner reassignment for open tasks.

## 8. Errors

| Code | Meaning |
|---|---|
| `TEAM_NOT_FOUND` | No Team with that id/label in this composition |
| `TEAM_AMBIGUOUS` | Legacy duplicate labels; use the Team id |
| `TEAM_FORBIDDEN` | Caller is neither the composition root nor a Team member |
| `TEAM_MEMBER_REQUIRED` | Owner/target is outside the selected Team |
| `TEAM_MEMBER_MODE` | Member/owner is one-shot, or would become one |
| `TEAM_STRUCTURE_CONFLICT` | Graph edit would remove/disconnect/overlap a Team |
| `TEAM_OVERLAP` | Creation would overlap an existing Team |
| `TEAM_LABEL_CONFLICT` | Team label already in use |
| `TEAM_NOT_CONNECTED` | Creation would produce a disconnected member set |
| `TASK_LIMIT` / `TEAM_TASK_LIMIT` | The 256 non-deleted task scope cap was reached; the Team tool layer maps it to `TEAM_TASK_LIMIT` |
| `TEAM_TASK_DELETED` | A Team tombstone cannot be mutated |
| `TEAM_TASK_STALE_REVISION` / `TEAM_TASK_UNAUTHORIZED` | Team tool-layer aliases for stale CAS and unauthorized mutations |

## 9. Verification

- Automated: `node --test tests/*.test.mjs` — 181 pass / 0 fail.
- Live 2026-11-20: `team_list`, explicit `team` scope, Team Lead owner
  resolution, revision changes, duplicate-label rejection, and Team task
  isolation passed. A `composition_task` create/update output leak was found,
  fixed, rechecked after HMR, and covered by a regression test.
- Structural graph guard was not live-exercised because the current root was
  running (`AGENT_BUSY`); manager tests cover it.
- Evidence: [`TEAM-TEST-2026-11-20.md`](TEAM-TEST-2026-11-20.md),
  [`DESIGN-REVIEW-2026-11-19.md`](DESIGN-REVIEW-2026-11-19.md).
- Native-vs-plugin parity review:
  [`TEAM-NATIVE-COMPARISON-2026-11-20.md`](TEAM-NATIVE-COMPARISON-2026-11-20.md).
