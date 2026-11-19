# 设计、架构与使用审查 — 2026-11-19

范围：当前 checkout（DSH `0.2.2-rc.5`，`desktop` profile），包括组合
overlay、Team/任务板、Team 形状工具、clone/bud、session cleanup、Client UI 和
现有文档。检查方式：

- 逐项审阅 `src/*`、`client.js`、`index.js` 与 DSH 相关契约；
- 对照 `docs/HANDOFF.md`、`docs/ARCHITECTURE.md`、`docs/COMPOSED-PROFILE.md`；
- 运行全量测试与静态检查；
- 在实机 Host 上执行 Team 创建、任务创建/读取/重派/完成/删除和清理；
- 不删除任何真实 Session。

> 结论：审查时 171 个测试全绿、实机调用通过，但发现 Team/任务板在多 profile、
> 多个 Team、图结构变化和“替代原生 Team”承诺上存在一组问题。
>
> **修复状态（2026-11-19）：R1–R7、R9、R11、R12 已修复；R8 保留为明确的产品
> 边界；R10 已补 owner/reassign，claim 仍由模型工具负责。全量测试现为 179
> pass / 0 fail。** 本文件保留原始审查证据，下面的“修复状态”表给出对应实现。

## 契约

修复后的 Team 模型、HTTP/tool 参数、授权和生命周期统一记录在
[`TEAM-API.md`](TEAM-API.md)。

## 修复状态

| 项 | 状态 | 实现 |
|---|---|---|
| R1 | 已修复 | task/Team/clone 写入与删除调用 `writeRevision()`；新增 revision 测试 |
| R2 | 已修复 | `team` 参数、`team_list`；组合根可管理所有 Team，非根限本 Team |
| R3 | 已修复 | UI 默认只选 continuable 本地节点；复选框同源；one-shot 不显示 |
| R4 | 已修复 | 每次 composition save 校验 Team；失效移动/删除/重叠直接拒绝 |
| R5 | 已修复 | Team 成员/Lead/owner/reassign/claim 限制 continuable |
| R6 | 已修复 | legacy `composition_task` 只列/改 composition board |
| R7 | 已修复 | 额外工具用 `when` 限定有组合的调用者 |
| R8 | 边界 | 文档明确只是 Team 形状任务板，不是完整原生 Team |
| R9 | 已修复 | 每个 composition 在 localStorage 记住选中 Team |
| R10 | 部分修复 | UI 增加 owner/reassign；claim 仍由 Team 工具使用 |
| R11 | 已修复 | Team label 唯一；owner 仍可用 node/session id 消歧 |
| R12 | 已修复 | 创建时始终显式保存 nodeIds |

## 1. 高优先级：确认的问题

### R1. Team/Task 写入没有发布 `.revision`，跨 profile 不收敛

**证据**

- `src/store.js` 的 `writeRevision()` 只在 composition/policy 写入后调用
  （当前实现中的四处 `writeRevision()`）。
- `putTask`、`deleteTask`、`putTeam`、`deleteTeam` 直接 `durableWrite` 后
  返回，没有 `writeRevision()`。
- `manager.createTeam` / `deleteTeam`、`manager.createTask` / `updateTask`
  也不写 composition，因此不会间接触发 revision。

**影响**

- 另一个 profile 的 storage-domain 不会 reopen；其 `/state` 中 Team 和
  Task 会保持旧快照，直到该 profile 发生一次 composition/policy 写入。
- 这直接削弱 README 和 AGENTS 中“跨 profile 最终收敛”的承诺；Team 功能在
  多 profile 协作时会出现“创建成功但另一个 profile 看不到”的现象。
- 同样的缺陷原本也影响 task board；本轮 Team 让问题更明显。

**建议**

- 在 `putTask/deleteTask/putTeam/deleteTeam` 的 durable write 后调用
  `writeRevision()`；这些操作已在 manager 的 mutation lock 内，revision
  会被正确延迟到 mutation 结束。
- 为 Team/Task 增加双 profile 回归测试：A 创建 Team/Task，B 在下一次
  `/state` 或轮询后看到它。

### R2. UI 选中的 Team 不是模型工具的 Team 作用域

**证据**

- `client.js` 的 `activeTeamId` 只是 Client 本地 React state；没有进入
  `/state`、tool call 或 session 上下文。
- `src/controls.js` 的 `nativeTaskScope()` 只用
  `manager.teamForNode(rootSessionId, caller.callerNode.id)` 找调用者所属
  Team；四个 `team_task_*` 参数 schema 没有 `team_id`/`team` 字段。

**影响**

- 用户可以在 UI 选择任意 Team 查看任务板，但模型从当前调用者调用
  `team_task_*` 时仍可能落到 composition board 或**另一个** Team。
- 若组合根不在某个子 Team 中，根代理无法用工具管理那个 Team 的任务；
  多个 Team 并存时无法显式选择。
- 这是“UI 可用、模型工具不可用”的使用层不一致。

**建议**

- 为 `team_task_*` 增加可选 `team_id`/`team`，校验调用者是 Team 成员或
  Team Lead；UI 将选中 Team 传给对应的 tool context。
- 或者明确规定 Team 必须包含调用者/组合根，并在创建时校验。
- 增加 `team_list`/`team_get` 只读工具或把 Team 列在 Tool 输出中，避免
  模型无法发现 Team。

### R3. Team 创建 UI 的默认成员集包含没有复选框的 external/hidden 节点

**证据**

- `client.js` 中 `teamMemberIds({rootNodeId: lead})` 使用完整
  `state.composition` 做 BFS，包含 external placeholder 和隐藏的 one-shot。
- 默认 `teamSelected` 直接使用这个完整集合。
- 但 Team 成员复选框只渲染 `teamLeadNodes`（仅 `kind === 'session'`）。
- 服务端 `manager.createTeam` 拒绝 `kind !== 'session'`。

**影响**

- 当 Lead 的子树里有 external 节点时，默认选择包含它，但 UI 没有对应
  复选框，用户无法取消；创建总是失败并报 `a Team may contain only local
  session nodes`。
- 隐藏的 one-shot 本地节点也不会显示复选框，可能被默默加入 Team。

**建议**

- 默认 `teamSelected` 只保留 `teamLeadNodes` 中的 local session id；
- 或给所有节点渲染复选框，external/不可用节点 disabled 并解释原因；
- 增加一个外部节点子树的 UI 回归测试。

### R4. Team 成员/任务没有随组合图移动或重连

**证据**

- `manager.migrateMovedSideTables()` 只迁移 tasks 和 policy，不迁移或清理
  `teams`。
- `withRootLocks`/跨组合移动路径在保存 target/source 后没有 Team
  reconcile。
- `pruneTeams()` 只在 `removeNode()` 末尾调用；`setParent()` 不调用。
- `pruneTeams()` 只检查 Lead 是否还存在，且 `teamNodes` 会静默过滤掉已不
  存在的 `nodeIds`。

**影响**

- 跨组合移动 Team 成员/Lead 后，source Team 保留失效 node id，target
  composition 没有 Team；Team task 的 `teamId` 也可能指向 source Team。
- reparent 可以把一个 Team 变成不连通，或让两个 Team 重叠；之后
  `teamForNode` 选第一个匹配，任务 owner/scope 可能落到错误 Team。
- 删除非 Lead 成员不会清理 Team 记录；Task 的 owner 可能指向已删除节点。

**建议**

- 任何 composition save 后统一 reconcile Teams：验证成员存在、连通、
  Lead 在集合内、互不重叠；不合法时显式报错或标记而不是静默漂移。
- 跨组合移动前阻止影响 Team 的移动，或迁移/删除 Team 和 scoped tasks。
- 增加移动、reparent、删除非 Lead 成员、重叠等图变更测试。

### R5. Team 成员/owner/Lead 没有限制为 continuable

**证据**

- `manager.createTeam()` 只检查 `node.kind !== 'session'`，未检查
  `node.mode`。
- `manager.createTask()` / `updateTask()` 的 Team owner 校验同样只看
  node id。
- UI 在打开 **Show one-shot agents** 后允许 one-shot 节点出现在 Team 表单。

**影响**

- 原生 Team 的成员是 continuable 子代理；当前实现可以把 one-shot 节点设为
  Team Lead/owner，但 one-shot 不能 follow-up，`team_task_*` 的 reassign /
  claim / 完成生命周期语义会与原生 Team 不一致。
- 这把“代替原生 Team”做成了“任意本地节点任务板”，不是原生 Team。

**建议**

- Team 成员、Lead、task owner、reassign target 限制为
  `mode === 'continuable'`（或明确允许并文档化的例外）。
- UI 禁用 one-shot 成员复选框，并显示原因。

## 2. 中优先级：设计/使用不一致

### R6. `composition_task` 仍能看到所有 Team 任务

- `src/controls.js` 的 legacy `composition_task` list 调用
  `manager.getTasks(rootSessionId)`，没有 `teamId === null` 过滤。
- 而 UI 的 Composition board 只显示无 Team 任务。
- 影响：模型用 `composition_task` 会看到 Team 任务；虽然 update/delete
  仍会走 Team 授权，但列表和 UI 语义不一致，也可能把 Team 内部工作暴露给
  误用该工具的模型。
- 建议：legacy list 过滤 `teamId === null`，或明确把 `composition_task`
  标记为 aggregate/audit 入口；增加一致性测试。

### R7. Team 形状工具是全局注册，而不是按 Team/组合可用

- `controls.register()` 在无原生 Agent Teams 时始终注册四个工具；没有
  `when` 条件。
- 原生 Team 工具按 Team mode 条件暴露；当前工具在任何会话都出现在工具
  列表中，未加入组合的调用者只会在执行时得到 `NOT_IN_COMPOSITION`。
- 影响：prompt/tool catalog 固定成本、模型误用、与原生 Team 的条件可见性
  不一致。
- 建议：按 Agent scope 或 `when` 条件提供；或在描述中明确“无 Team 时是
  composition board”。

### R8. “替代原生 Team 各项功能”只完成了任务板替代

当前 Team 只实现了：

- 成员集合/Lead；
- Team-scoped 任务板与任务工具；
- 任务 owner/依赖/写范围。

没有实现或明确替代原生 Team 的：

- Team mode 的启用/禁用和策略提示；
- Team roster/成员发现工具；
- Team 专属的 message/interrupt 权限模型；
- 共享 checkout/文件系统语义（DSH 原生 Team 也强调共享 checkout，本插件
  不能也不应伪装）；
- Team 级审计/运行状态视图。

文档已经写了 overlay-only / no shared checkout，但需求“代替原生 team 各项
功能”与当前实现范围存在差距。建议把产品定位明确为“Team 形状的任务板 +
成员作用域”，不要宣称完整原生 Team 替代。

### R9. Team 选择在刷新后丢失

- `activeTeamId` 是纯 Client state，没有放到 URL、composition 或 session
  状态。
- 刷新页面或重新打开 tab 后回到 Composition board，用户需要重新选择 Team。
- 对多 Team 的工作流是持续性的使用摩擦。
- 建议：按 composition 持久化最后选择的 Team，或在 Team 列表上提供明显
  默认。

### R10. UI 可编辑任务板与原生 Team UI 的功能不对称

- UI 任务行只有 Start/Complete/Reopen/Delete；`team_task_*` 工具支持
  claim/release/edit/set_dependencies/reassign。
- 原生 Team UI 是只读的，因此“强制模仿”本身可以只读；但当前 UI 是
  可编辑的，用户会期待同等的 claim/reassign/dependency 操作。
- 建议明确产品选择：要么 UI 只读（和原生一致），要么补齐 owner/reassign
  和依赖编辑。

### R11. Team/owner 标签重复导致歧义

- Team label 没有唯一性校验；`team_task_list` 的 `owner` 按节点 label
  解析，`resolveTarget` 对重复 label 抛 `AMBIGUOUS_TARGET`。
- 多个同名 Team 在 `<select>` 中也难以区分。
- 建议 Team label 唯一，或在 UI/tool 输出中显示短 id；owner 使用 node id +
  label 双字段。

### R12. Team 两种成员语义并存

- API 不提供 `nodeIds` 时，Team 使用 Lead 的动态子树；
- UI 总是提交显式 `nodeIds`，成为固定集合；
- 同一种记录可能随图变化自动扩张或保持固定，后续行为不可预测。
- 建议创建时始终固化 `nodeIds`，或者始终使用动态子树；不要同时支持两种
  未明确区分的模式。

## 3. 低优先级 / 工程卫生

- `src/controls.js` 的 `nativeTaskView` 前有一段重复的注释起始符
  （`/** ... /** ...`），不影响运行但应清理。
- `docs/HANDOFF.md` 仍有“clone 只复制 task board”的旧描述；现在代码也复制
  Team 定义并重映射 task `teamId`，文档需要同步。
- `docs/TEAM-TEST-2026-11-19.md` 的实机测试使用本机端口和临时 Team 名称；
  作为历史记录可以接受，但不应被当作长期配置示例。
- 实机测试会写 `session-cleanup`/Team audit 行；测试 Team/Task 已清理，但
  audit 记录仍保留。若测试环境需要完全无痕，应使用单独的临时 profile。

## 4. 已验证正常的部分

- 修复后全量测试 **179 pass / 0 fail**。
- 实机 Host：
  - 创建两节点 Team；
  - `team_task_create/list/get/reassign/complete/delete` 全通过；
  - composition-only task 没有出现在 Team 列表；
  - 删除 Team 后其 scoped task 消失；
  - 最终 teams/tasks 为空，无测试残留；
  - 没有删除或修改真实 Session。
- `node --check`、`git diff --check` 通过。
- Team 表在实际 durable storage 上可创建和读取（说明当前 DSH storage
  domain 能接受新增表；版本/迁移风险仍需长期验证）。

## 5. 建议修复顺序

1. 先修 R1（revision）和 R2（team_id/tool scope），这是多 profile 和多 Team
   使用正确性的基础。
2. 修 R3（UI external 默认成员）和 R4（图变更 reconcile），这是会导致
   Team 创建失败或数据漂移的用户可见问题。
3. 明确 R8/D1 的产品边界，并在文档和工具描述中统一“Team 形状”与“原生
   Team”的差异。
4. 补 R5/R6/R10/R11 的校验与测试。
5. 清理文档/注释和 live-test audit 记录。
