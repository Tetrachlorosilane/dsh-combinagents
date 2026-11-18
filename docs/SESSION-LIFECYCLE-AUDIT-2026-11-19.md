# 会话生命周期 / 野会话 / 存储放大审计（2026-11-19）

- 对象：`@dsh-external/dsh-combinagents`，当前工作区（提交基线 `b1f2494` 之后）
- 环境：DSH `0.2.2-rc.5` Desktop，`127.0.0.1:64806`，`desktop` profile
- 方式：逐条检查所有会创建 Session 的代码路径；用本地存储快照统计
  `session.v4.jsonl.zstd`、clone/task/audit 记录；不读取/打印标题与 cwd；
  未删除或修改任何真实 Session
- 结论先行：**正常 operation 不会凭空复制 Session；clone/bud 会按设计为每个节点
  创建一个新 Session，fork 会复制历史。真正的问题是失败/删除后的清理只清
  overlay，不清 Session，当前已观察到约 166 MB 的“克隆树孤儿”。**

---

## 1. 所有会话创建通路

| 通路 | 是否新建 Session | 是否复制历史 | overlay 关联 | 失败/删除后的 Session |
|---|---|---|---|---|
| `subagent`（spawn） | 是，1 个 native child | 否（fresh context） | `autoAttach` 镜像 | 保留；native parent 可追溯，`sync-native` 可恢复 overlay |
| `subagent_fork`（fork） | 是，1 个 native fork child | 是，继承 parent 历史 | `autoAttach` 镜像 | 保留；fork 是**新 native root**，镜像失败时 `sync-native` 通常无法发现，需手工加入 |
| `clone-tree`（whole root tree） | 是，每个 local node 1 个 | 是，复制 completed-turn prefix | install composition + clone record + 复制 task | **保留**；失败时没有 clone record，很难再定位 |
| `bud`（subtree as new root） | 是，每个 local node 1 个 | 是 | 同上 | 同上 |
| `workflow` / 其他 native 子代理 | 由 native runtime 创建 | 取决于 provider | 只由 `subagent/start` 镜像 | 不影响；插件不额外复制 |
| `add-node` / `add-external` / `sync-native` / `remove-node` / reparent / grant / task / rename | 否 | 否 | 只改 overlay | 不创建、不删除 Session |
| `send_message` / `wait_agent` / `interrupt_agent` | 否（cold resume 复用已有 Session） | 否 | 只投递/中断 | — |
| `/create`、`/state`、`/summary`、`/sessions`、`/titles`、`/external` | 否 | 否 | 只读/建记录 | — |
| `delete-composition` / 删除节点 | 否 | 否 | 删除 overlay/task/clone 记录 | **Session 保留**（产品不变量） |
| clone root 句柄驱逐/`releaseRoot` | 否 | 否 | 只 dispose live handle | Session 保留；composition 仍可存在 |

结论：除了 `subagent`、`subagent_fork`、`clone-tree`、`bud`，本插件没有任何
隐藏的 Session 创建路径。`sync-native`、`add-node`、任务板、消息、审批都不会
复制 Session。

---

## 2. 发现

### W-1（High）clone/bud 失败后只清理 overlay，已创建 Session 全部留下

`src/clone-manager.js` `execute()` 的 catch 会：

- dispose 尚未完成的 child activation；
- detach 已 attach 的 workspace；
- dispose clone root handle；
- 删除 root composition 记录、task、clone 记录。

但 DSH 没有“删除 Session”的 API（只有 workspace archive），所以：

- `createRoot` 已成功、后续任一 child/`installComposition`/`store.putClone`/
  `store.putTask`/`getTasks` 失败时，**root Session 和已创建 child Session 都
  仍然持久化**；
- 失败不会写 clone record（当前记录只在成功路径写 `status: completed`），
  因此事后无法从 clone 记录反查这些 Session；
- 这些 Session 通常 `isSeeded: true`，top/no-parent（root）或
  subagent/parent=clone root（children）。

本次已做两项低风险加固：

1. `createChild` 若 `startActivation` 已发布 child，但随后读不到 live agent，
   现在会 `activation.dispose()`，不再留下 live activation；Session 仍然持久化。
2. `execute` 失败时把已创建 Session id 与 root id 写入 warning 日志，便于人工
   archive；不自动删除 Session。

**未修复的产品级问题**：失败 clone 没有 durable orphan 记录，也没有 UI 清理入口。
删除 Session 需要 DSH 能力或产品明确授权，不能在插件里静默做。

### W-2（High）删除 clone composition 后整棵克隆树仍在存储里

`delete-composition` 按设计只删除 overlay、task、clone record，不删除 Session。
对 clone 组合来说，这会把一棵 clone tree 变成“无 composition、无 clone record”
的孤儿树。UI 的确认文案只说“不会删除 DSH Session”，用户很难意识到：

- clone record 被删除后，无法再从插件 UI 找到这些 Session；
- 它们仍出现在 DSH session picker / 存储中；
- 一棵 16 节点 clone 可达数十 MB。

这是产品不变量（删除节点不删除 Session）与 clone 生命周期之间的真实摩擦，
不是 bug，但需要显式清理/归档策略。

### W-3（Medium）`subagent_fork` 镜像失败会产生 overlay 外的 new root

`src/controls.js` `startDelegation()` 在 `startActivation` 成功后调用
`manager.autoAttach`，失败只 catch 不抛错：

- 对 `subagent`（spawn）child：native parent 链条仍在，`sync-native` 可从
  composition root 找回；
- 对 `subagent_fork`：fork child 是**新 native root**，`sync-native` 的
  `listDescendants` 通常不会把它列进原树；如果 autoAttach 失败，它会成为
  overlay 外的 Session，需要手工 Add session。

本次加固：

- 记录 warning（含 childSessionId），提示手工加入；
- 区分 autoAttach 失败与 grant 失败；
- audit `delegation` detail 增加 `mirrored` 布尔值。

没有自动重试/自动加入，避免在用户不知情时改变组合。

### W-4（Medium）clone/fork 的存储放大是设计性的，但无预算/配额

`cloneTree` 克隆 **whole root tree**，`bud` 克隆子树；每个 local node 都是
新 Session，复制 completed history prefix；task board 也复制。`subagent_fork`
复制 parent history。重复 clone/重复 fork 线性增长，无去重、无总 Session 配额、
无“复用同一快照”机制。

当前实机数据（v4 session 文件）：

| 指标 | 数值 |
|---|---|
| 总会话（`session.v4.jsonl.zstd`） | 545 个 / **948.9 MB** |
| 当前 clone records | 13 个，全部 `completed`；共 **36** 个 clone Session / **51.9 MB**（5.5%） |
| 最大单次 clone | 16 nodes；源 Session 76.7 MB → clone **41.9 MB**（约 55%） |
| clone 记录/任务/audit 元数据 | 13 clones 20 KB；10 tasks 4.6 KB；67 audit 27 KB；28 compositions 70 KB；9 policies 3 KB |
| 已被删除 clone record 的“克隆树孤儿” | **20 个 root + 43 个 child = 63 Session；166.3 MB（17.5%）** |
| 当前仍被 clone record 追踪的 clone 树 | 36 Session / 51.9 MB |

关于孤儿树的判定：

- 20 个 root 的特征是 `isSeeded: true`、无 `parentSession`、不在任何 composition、
  不在任何当前 clone record；这是 clone root 的典型形状；
- 43 个 child 全部以这 20 个 root 之一为 `parentSession`，且不在 clone record/
  composition；因此这 63 个 Session 构成 9 棵有子级的 clone 树（另有 11 个单节点
  root）；
- DSH 的 `isSeeded` 也标记原生 fork，所以不能把**所有** seeded Session 都算作
  插件 clone；但上述 20+43 的父子结构与 clone root/child 高度吻合；
- 当前 clone-like（36 tracked + 63 orphan）合计约 **99 Session / 218 MB**，
  占全部 Session 的 **18.2% 数量 / 23.0% 字节**；其中 orphan 占 clone-like
  的 **63.6% 数量 / 76.2% 字节**。

这不是“插件偷偷复制”；是 clone/bud 功能按设计复制，叠加“删除 overlay 不删除
Session”后的结果。对用户而言，确实会造成无用 Session 比例和存储上升。

### W-5（Low）clone root handle dispose 失败会留下不可追踪的 live activation

`execute` 失败清理和 `releaseRoot` 都 catch dispose 错误并只 log。若 dispose
自身失败，Session 已经是持久化状态，但 live handle 不再在 `rootHandles` 中；
后续只能靠 DSH runtime 回收。Session 存储不受影响，但会多占内存/活跃配额。
当前代码已尽量 log，未做盲目重试。

### W-6（Low）audit/task/archive 的长期增长独立于 clone

- audit active 裁剪到 5000，archive 永不裁剪；当前 archive 为空，但长期使用会
  增长；
- task board 无每组合上限；
- clone 记录/task 元数据很小，主要存储仍是 Session 日志。

这些不是“野会话”，但属于用户问的“意料之外存储空间”的一部分。

---

## 3. 是否会出现“游离野会话”的判定

| 场景 | 是否游离 | 说明 |
|---|---|---|
| `subagent` 正常 | 否 | native child，parent 链可解析；插件镜像后属于 composition |
| `subagent` autoAttach 失败 | **半游离** | native parent 仍在；`sync-native` 可恢复 overlay，Session 不是无主 |
| `subagent_fork` 正常 | 否 | 插件 autoAttach 成功，进入 composition |
| `subagent_fork` autoAttach 失败 | **是（overlay 外）** | 新 native root；`sync-native` 通常找不到，需手工 Add |
| clone/bud 成功 | 否 | root/children 都在新 composition + clone record |
| clone/bud 中途失败 | **是** | 已创建 Session 保留；无 clone record/composition；仅日志可追溯 |
| 删除 clone composition | **是（相对插件）** | Session 保留且 clone record 被删；DSH 仍可见 |
| 删除普通 composition / remove node | **是（相对插件）** | 产品不变量明确保留 Session |
| 重复 clone / fork | 不是“游离”，但会产生**大量新 Session** | 每次都是新的 root/tree |

因此：**正常路径不会产生野会话；失败 clone、fork 镜像 miss、删除 clone
composition 是三条会产生无 overlay 归属 Session 的路径。**

---

## 4. 2026-11-19 加固落地

建议 1、2、3、5 已实现，建议 4 已做短重试，建议 6 的容量预估与清理入口已接
入组合 tab：

1. **失败 clone journal**：`execute` 失败时写入 durable
   `clone(status:'failed', newRootSessionId, nodeMapping, snapshotAt, failure)`。
   Session 仍保留，但不再“不可发现”。
2. **删除 clone composition 不再丢 provenance**：`deleteComposition` 把
   clone record 标为 `orphaned`，而不是删除；清理工具可据此找到残留树。
3. **用户确认的会话清理**：组合 tab 新增 “Session cleanup”：
   - 预览 tracked `failed`/`orphaned` clone sessions、可选的 historical seeded
     suspects、one-shot 占位/叶子节点；
   - 预览只读，显示数量、体积和前 5 项标题；
   - 每一项可单独展开首条用户消息/最后消息摘要（`/session-cleanup/session`），
     按需读取，不批量加载全部冷日志；
   - 删除是独立按钮；只有用户显式勾选 historical suspects 并再次确认后才删除；
   - 不删除 live session、composition member 或其 native ancestor；
   - 删除后 detach workspace、unarchive/unpin，并移除已完成清理的 clone
     record。
4. **fork mirror miss**：`subagent_fork` 的 `autoAttach` 失败会短重试一次；
   仍失败时 warning 明确提示 “add it manually if it is a fork root”，不自动
   改写用户组合。
5. **clone/bud 预检与容量提示**：确认框显示将创建的新 Session 数和源历史
   体积估算（`/clone-estimate`），并提示重复 clone/bud 会线性增长。
6. **文档**：README（中英）说明清理入口、`sessionRoot` 覆盖、删除不可撤销，
   以及 clone/fork 会复制历史。

实现边界：

- DSH 0.2.2-rc.5 没有公开的 Session 删除 service；清理工具只对默认
  `$DSH_HOME/sessions` JSONL 根执行目录删除，custom backend 需配置
  `sessionRoot`，否则返回 unavailable。composition storage 为 memory 或
  reload degraded 时也会 fail closed，避免在看不到组合归属时误删。
- 清理工具不会删除 composition member；one-shot node 先通过 manager 以
  promote 方式移除，再删除其非 live 的本地 Session。one-shot external
  placeholder 没有本地 Session，只删除 overlay 节点。
- historical seeded suspects 是启发式（`isSeeded + 无 composition`），既覆盖无
  parent 的 clone 根，也覆盖保留 `parentSession` 的 `subagent_fork` mirror miss；
  可能包含普通 native fork，因此默认不选，必须显式确认。
- 不自动删除、不后台清理；`delete-composition` 和 `remove-node` 仍遵守
  “删除 overlay 不删除 Session”的产品合同。

## 5. 本轮代码与验证

- `src/clone-manager.js`：
  - `createChild` 在 child activation 已发布但 agent 不可读时 dispose activation；
  - `execute` 失败时写 failed clone journal，并 warning 记录
    `createdSessionIds`。
- `src/manager.js`：删除 clone composition 时把 clone record 标记为
  `orphaned`，保留 Session 映射。
- `src/controls.js`：`subagent_fork`/`subagent` 的 `autoAttach` 失败短重试一次；
  仍失败时记录 manual-add warning；grant 失败单独 warning；audit 带 `mirrored`。
- `src/session-cleanup.js` + `/session-cleanup` + `/clone-estimate`：
  preview、显式清理、容量估算；仅处理非 live、无组合归属的候选。
- `client.js`：组合 tab 的 Session cleanup 面板、候选列表、DSH 风格确认框，
  以及 clone/bud 的节点数/体积提示。
- `README.md` / `README.zh.md` / `AGENTS.md`：同步更新。
- 全量测试 **165 pass / 0 fail**，覆盖 cleanup 分类/删除/保护、failed clone
  journal、orphaned clone record、fork mirror 重试和新增 HTTP 路由。

**仍然不做**：不自动删除任何真实 Session；不对 live Session 做后台清理；不把
清理入口暴露给未持有 loopback token 的调用方。
