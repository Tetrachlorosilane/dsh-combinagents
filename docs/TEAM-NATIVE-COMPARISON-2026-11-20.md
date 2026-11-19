# 原生 Team 工具与插件 Team 工具对比 — 2026-11-20

评估对象：

- 原生：`@deepseek-ai/dsh-tool-agent-team` + `@deepseek-ai/dsh-agent-team`（DSH `0.2.2-rc.5`）
- 插件：`dsh-combinagents` 的 `team_list` 与 `team_task_create/list/get/update`

本文分别看**模型可见表观**（名称、描述、参数、输出、可用性、提示词、错误）和
**内部实现质量**（权威、持久化、校验、边界、测试）。

## 0. 本轮修复后的状态（2026-11-20）

对比后立即做了高优先级对齐，当前代码已具备：

- Team task delete 使用 tombstone（`status: deleted`），`get` 可读，`list` 排除，
  再次 update 返回 `TEAM_TASK_DELETED`；删除响应不再出现 `deleted + ready:true`；
- 每个任务作用域最多 256 个非删除任务，`TASK_LIMIT`；
- subject/description 超长报错（不再静默截断），description 上限 16,384；
- write scope 拒绝绝对路径、盘符、`.`/`..`/空段，并做斜杠规范化；
- 重复 blocker 报错；ownerName 在指派时快照，UI/工具输出优先使用快照；
- write-scope warning 只比较其他 `in_progress` 任务，文本对齐原生。

组合任务（非 Team）仍保留旧的 hard delete 语义；Team 工具只在有组合时可见。
原生 Team mode、Team policy prompt、task id 格式、多 Team/子集作用域和错误码
仍未完全对齐。

## 1. 结论摘要

**表观层接近，语义层不等价。**

插件在基础路径上是一个可信的 Team task façade：

- 使用相同的四个工具名；
- 使用相同的 task 字段名、action 枚举、CAS `expected_revision`；
- 使用 `owner`、`blockedBy`、`writeScopes`、`ready`、`writeScopeWarnings`；
- 输出为 compact JSON；
- Team task 的 create/list/get/claim/complete 基本可用。

但它不是原生 Team 的 drop-in replacement：

- 原生 Team 是**一棵 subagent tree + Team mode + 固定 policy**；插件是**组合图上的多个显式 Team 子集**；
- 原生工具有 `team:policy` system prompt；插件没有 Team policy；
- 原生有严格的任务上限、删除 tombstone、ownerName 历史、写入 scope 规范化、最大长度校验；插件本轮已补大部分，但仍保留描述空值和错误码差异；
- 原生删除后 `get` 可读 tombstone；插件 Team task 已改为 tombstone（legacy composition 仍是 hard delete）；
- 原生 `team_task_list` 不返回 deleted；插件虽然也不返回，但原因不同且没有 tombstone 语义；
- 原生 owner 是 subagent name/ID + 不可变 ownerName；插件本轮已保存 ownerName 快照，未命名/旧记录仍回退到组合 label/id；
- 原生工具只在 Team mode enabled 时出现；插件工具在组合存在时出现，且没有 Team mode；
- 原生错误是 `TEAM_*` typed errors；插件 Team tool 层已映射到 `TEAM_TASK_*` 等原生词汇，但 HTTP/manager 仍保留 `TASK_*` 内部码。

**评级（主观、按模型行为风险）**

| 维度 | 表观一致性 | 语义一致性 | 风险 |
|---|---|---|---|
| 四个工具名与基础 schema | 高 | 高 | 低 |
| 基本 create/list/get/claim/complete | 中高 | 中 | 中 |
| owner/reassign 语义 | 中高 | 中 | 中 |
| deleted/tombstone | 高（Team）/ 中（legacy composition） | 高（Team） | 中 |
| 任务上限、长度、write scope 校验 | 中高 | 中高 | 中 |
| Team mode/policy prompt | 低 | 低 | 高 |
| 多 Team/composition scope | 无原生对应 | 插件新增 | 中 |
| 错误码/失败语义 | 中 | 中低 | 中 |

## 2. 模型可见表观对比

### 2.1 工具名称与可用性

| 项目 | 原生 | 插件 |
|---|---|---|
| 工具数 | 4 | 4 + `team_list` |
| 名称 | `team_task_create/list/get/update` | 同名 |
| 可用条件 | 当前 root Session 开启 Team mode；root 活跃 | 调用者属于组合；native Team 不存在时注册 |
| Team 单位 | 一个 root subagent tree 一个隐式 Team | 组合图上可创建多个显式 Team |
| Team 选择 | 无参数，root 决定 | 可选 `team` id/唯一 label；`team_list` 发现 |
| Team mode | 有开/关，关闭隐藏工具和 policy | 无 Team mode |
| 共享 checkout | 原生 policy 明确同一 cwd/filesystem | 组合节点各自 cwd；没有 Team 共享 checkout |

模型感受差异：

- 原生模型知道“同一个 Team 的成员共享工作区、scope 是 advisory”；
- 插件模型只看到 task 工具和有限的描述，没有这段 policy；它可能低估写入冲突；
- 原生 root 关闭 Team mode 后模型看不到任务工具；插件即使没有原生 Team mode，只要在
  组合中就能看到任务工具；
- 插件多出的 `team_list` 与 `team` 参数不是原生协议的一部分，模型需要额外学习。

### 2.2 工具 schema 与描述

| 工具 | 原生描述 | 插件描述 | 参数差异 |
|---|---|---|---|
| create | “Create one unowned pending task on the shared Team task board.” | “...selected composition Team board using the Team task API shape.” | 插件多 `team`；其余相同 |
| list | “List shared tasks...” | “List composition Team tasks...” | 插件多 `team`；owner 描述为 label/session/lead |
| get | “Read the complete latest value of one shared task...” | “...one composition Team task...” | 插件多 `team` |
| update | “Compare-and-set a shared task action...” | “...composition Team task action...” | 插件多 `team`；owner 描述扩大到 Team Lead/composition root/user |

字段级：

- `blocked_by`、`write_scopes`、`owner`、`task_id`、`expected_revision`、八个 action
  名称基本一致；
- 原生 owner 过滤接受 **agent name**（包括 `reviewer/checker` 路径）或 Session id；
  插件接受组合 node id、Session id、唯一 label，且 `lead` 是**当前 Team 的 Lead**；
- 原生 create 不接受 owner/team；插件不接受 owner，但接受 team；
- 插件输出模型与原生一样省略 `ownerId`，把 owner 映射成 `owner`。

### 2.3 输出视图

共同字段：

`id`, `revision`, `subject`, `description`, `status`, `owner?`, `blockedBy`,
`writeScopes`, `ready`, `writeScopeWarnings`

差异：

- 原生 ID 是 `task-<n>`；插件是 UUID；
- 原生 `owner` 优先使用不可变 `ownerName`；插件本轮已保存 `ownerName` 快照并在
  UI/tool view 优先使用，未命名 owner 回退到组合 label/id；
- Team task deleted 现在是 tombstone：`get` 返回 status `deleted`，`list` 排除；
  legacy `composition_task` 仍是 hard delete；
- Team task delete 返回 `ready: false`；修复前曾出现 `ready: true`，已由回归测试覆盖；
- write-scope 警告已对齐：只比较其他 `in_progress` 任务，文本为
  `write scopes overlap with <taskId>`。

### 2.4 删除与 tombstone

这是最明显的语义差异，也是本轮实测证据：

原生：

1. delete 写入 `status: deleted` 的 tombstone；
2. `team_task_update` 返回 deleted view，`ready: false`；
3. `team_task_get` 仍可读到 tombstone；
4. `team_task_list` 不返回 tombstone；
5. 再次更新返回 `TEAM_TASK_DELETED`。

插件（本轮修复后）：

1. Team task delete 写入 `status: deleted` 的 tombstone，保留 revision 历史；
2. `team_task_update` 返回 deleted view，`ready: false`，owner/ownerName 保留；
3. `team_task_get` 仍可读到 tombstone；
4. `team_task_list` 过滤 tombstone；
5. 再次更新返回 `TEAM_TASK_DELETED`；
6. legacy `composition_task` 的 delete 仍是 hard delete（非 Team 路径，保留旧行为）。

修复前实测曾返回 `status: "deleted"`, `ready: true`，随后 `get` 为 not found；
这两点已由 manager/controls 修复，并有回归测试覆盖。

### 2.5 owner 与 reassign

原生：

- owner 解析走 subagent runtime 的 name/ID；
- root 可以 reassign 给自己或任意 reachable continuable descendant；
- 保存 `ownerName` 快照；历史任务保留旧名字；
- 其他成员只能 claim ready task；
- 历史 roster 不授予权限。

插件：

- owner 解析走组合 node id/session/label；
- 组合根是 overlay 管理员，可以操作任意 Team；Team Lead 可以管理本 Team；
- reassign target 必须属于该 Team（不是任意 subtree）；
- owner 本轮已保存 ownerName 快照；旧记录/未命名 owner 仍回退动态 label/id；
- 多 Team 时 `owner: "lead"` 是当前 Team Lead（修复后），不是原生 root。

因此原生模型习惯“owner 是稳定 agent 名/路径、root 可 assign 任意 descendant”的行为
不能直接迁移到插件；插件更接近“组合子集 + Team Lead”模型。

### 2.6 任务上限与校验

| 项目 | 原生 | 插件 |
|---|---|---|
| 最大非删除任务 | `maxTasks` 默认 256 | 每个作用域 256；HTTP `TASK_LIMIT`，Team tool `TEAM_TASK_LIMIT` |
| subject 非空/长度 | trim、非空、>200 报错 | trim、非空、>200 报错 |
| description | trim、非空、>16,384 报错 | trim、>16,384 报错（空值仍允许） |
| write scope | slash 标准化；拒绝绝对路径、盘符、`.`/`..`/空段；去重 | 已对齐 slash 标准化、拒绝绝对路径/盘符/`.`/`..`/空段；去重 |
| blockedBy 重复 | 报 `TEAM_INVALID_ARGUMENT` | manager `INVALID_FIELD`；Team tool 映射为 `TEAM_INVALID_ARGUMENT` |
| blockedBy 不存在/已删除 | 报 `TEAM_TASK_NOT_FOUND` | manager `TASK_NOT_FOUND`；Team tool 映射为 `TEAM_TASK_NOT_FOUND` |
| DAG cycle | 原生 task graph 校验 | `dependencyCycle` 校验 |
| 删除依赖者 | 拒绝 `TEAM_TASK_HAS_DEPENDENTS` | manager `TASK_HAS_DEPENDENTS`；Team tool 映射为 `TEAM_TASK_HAS_DEPENDENTS` |
| 取消 | 使用 `exec.signal`，append 前检查 | Team task 工具没有显式 signal 传播 |
| 错误码 | `TEAM_*` | Team tool 已映射 `TEAM_TASK_*`；HTTP/manager 内部仍是 `TASK_*` |

插件已对齐任务上限、subject/description 上限、write scope 规范化和重复 blocker
报错。剩余差异是 description 空值允许、HTTP/manager 内部错误码、以及没有原生同级的取消/持久化
确认语义。

## 3. 内部实现质量对比

### 原生

- `ctx.agentTeams` 是唯一权威；工具只做参数适配和 owner 名称映射；
- Lead Session log 是 source of truth；journal 事务、append/flush、projection；
- `rootOf` 由 subagent runtime 解析，Team 不维护第二套成员权限；
- task board 有 `maxTasks`、CAS、DAG、删除 tombstone、严格 scope/length 校验；
- 错误是 typed `TeamError`；取消可传播到 mutation；
- 失败有 `TEAM_TASK_PERSISTENCE_UNCONFIRMED` 等明确持久化语义；
- tool schema 与 execute 结果由类型/schema 编译器约束。

### 插件

优点：

- 组合图和 Team 独立于原生 Team state，不写 DSH Team；
- Team 结构校验、one-shot 限制、唯 label、跨 profile revision；
- 对基础 CRUD 有较完整的 186 测试与实机验证；
- 原生 Team 存在时让位，不 shadow 原生工具。

弱点：

- 重新实现一套 task board（manager/store），与原生规则靠人工对齐，存在 drift；
- 没有 `maxTasks`，没有原生同样的 length/scope 校验；
- 本轮已补 tombstone、256 上限、严格 scope/长度/重复 blocker、ownerName 快照和
  原生风格 warning；剩余的主要差异是 Team mode/policy、task id 格式、多 Team 作用域；
- 没有 Team mode / Team policy；任务工具可用性与原生不同；
- 没有原生同级的 cancellation/persistence confirmation 语义；
- Team tool 错误码已映射，HTTP/manager 内部码与原生仍不同；
- 缺少针对原生 contract 的系统 parity 测试（新增了部分回归，但还不是 schema snapshot 全套）。

原生实现质量更高，因为它把 Team 放在一个权威 domain 中。插件的质量不差，但它是一个
**兼容 façade + 组合 overlay**，不是原生 Team 的同一实现。

## 4. 实机证据与验证边界

修复前的实测（Host 当时加载旧 manager）：

1. 创建 `Parity probe` Team（root + agent-2）；
2. `team_task_create` 创建任务；
3. `team_task_update` delete；
4. 观察到 delete 返回 `status: "deleted"`, `ready: true`；
5. `team_task_get` 返回 not found；
6. 清理后最终 `teams: []`, `tasks: []`。

修复后的实机复测（Host 重启后，`Live parity 3` Team）：

- `write_scopes: ["../outside"]` 实际被拒绝，HTTP 返回 `TEAM_INVALID_WRITE_SCOPE`；
- `src/` 被规范化为 `src`；
- 重复 blocker 实际被拒绝；
- delete 实际返回 `status: "deleted"`, `ready: false`, `owner: "agent-2"`；
- `get` 实际仍返回 deleted tombstone；
- `list` 实际为空（过滤 deleted）；
- tombstone update 实际返回 `TEAM_TASK_DELETED`；
- 临时 Team/任务清理后 `/state` 为 `teams: []`, `tasks: []`。

256 上限由自动化测试覆盖，未用 256 个 live 任务填充。

Automated suite after the fixes: **186 pass / 0 fail**.

## 5. 建议

### 高优先级：语义对齐

1. **修复 delete 语义**：已完成 Team tombstone；legacy composition 仍 hard delete。
2. **增加任务上限**：已完成每个作用域 256。
3. **对齐输入校验**：已完成 subject/description 超长报错、scope 规范化、重复 blocker
   报错。
4. **保存 ownerName 快照**：已完成，output/filter/UI 优先使用快照。
5. **统一错误码**：Team tool 映射已完成；HTTP/manager 内部码保持插件 API 稳定。

### 中优先级：模型表观

6. **补 Team policy 或明确缺失**：原生 `team:policy` 告诉模型共享 cwd、scope advisory、
   等待 teammates；插件没有。若出于 cache 约束不加 prompt，应在工具描述/文档中明确
   模型不能假设共享 checkout。
7. **对齐 descriptions**：四个工具描述尽量贴原生，额外 `team` 参数单独解释，避免
   模型误以为 `team_task_*` 与 native Team 完全相同。
8. **补充 parity tests**：schema snapshot、delete/get/list、maxTasks、scope 校验、
   ownerName、错误码、tool availability。
9. **明确 `team_list` 的兼容定位**：它是插件扩展，不是原生 Team 工具；模型提示应
   说明何时使用。

### 产品边界

10. 不要把当前实现宣传为“完整原生 Team 替代”；更准确的表述是“Team 形状任务板 +
    组合子集成员作用域”。README/AGENTS 已经接近这个表述，但应继续强调。

## 6. 总评

| 问题 | 判断 |
|---|---|
| 名称、字段、action、基础 CRUD 是否像原生？ | **像** |
| 多 Team、team 参数、team_list 是否原生？ | **不是；插件扩展** |
| Team mode、team policy、共享 checkout 是否一致？ | **不一致** |
| owner/reassign 语义是否一致？ | **部分一致** |
| deleted/tombstone（Team）、limit、scope/length 校验是否一致？ | **基本一致；legacy composition 例外** |
| 内部权威/持久化质量是否同等级？ | **原生更高；插件是可用的 overlay，不是同一 domain** |
| 基础单 Team 任务流是否可用？ | **可用** |
| 边界场景是否会让模型误判？ | **Team task 边界已显著收敛；Team mode/policy、HTTP/manager 错误码、owner 子集仍有差异** |

结论：**表层兼容做得不错，Team task 的核心语义已向原生收敛；它仍应定位为兼容
façade，而不是原生 Team 的等价实现。** 若目标是完全模型行为一致，下一步优先：
Team mode/policy、错误码、task id/单 Team 作用域、取消/持久化确认和系统 parity 测试；
若目标是 overlay 的独立能力，则应明确标注扩展字段、扩展 Team 模型和缺失的 native
语义。
