# dsh-combinagents 设计与交接说明

> **文档地位**：这是交给下一位实现代理的产品需求与设计基线。  
> 与 `docs/ARCHITECTURE.md` 或 `docs/FEASIBILITY.md` 冲突时，**需求以本文为准**；
> DSH 技术事实仍以 `docs/FEASIBILITY.md` 的源码核对结果为准。  
> **当前状态**：仓库只有脚手架、纯图模型和调研文档；`index.js` 是 inert 入口。
> 还没有可用的运行时或 UI。不要把它当作已完成插件安装。

## 0. 给接手代理的摘要

这个项目要解决的不是“把组织图画出来”，而是三个真实的代理生命周期问题：

1. **带团队的会话无法完整分支**：DSH 的 fork 只复制一个 Session，不复制子代理树；
   分支后原团队上下文和成员关系丢失。
2. **跨项目/跨代理的信息交换只能人工复制**：DSH 的 `send_message` 只允许同一棵原生树。
3. **混乱上下文无法“出芽”成新主代理**：子代理不能原生升格为根；要重开只能人工搬运上下文。

因此产品至少需要三层能力：

- **Composition（组合）**：用户可编辑的汇报森林，独立于 DSH 原生 lineage；
- **Snapshot / Clone（快照与克隆）**：把一棵带子代理的树复制成新的 Session 树，
  用于分支和出芽；
- **Bridge（受控跨树通道）**：在明确授权的边上传送信息，不能偷偷复用原生
  `send_message` 的权限。

**没有第四层“原生换父”**：DSH 现有契约下，第三方插件不能把已有 Session 移到另一棵原生树。
这一点见第 4 节。

## 1. 原始目标与需求来源

### 1.1 原始目标

> 实现多个相同或不同来源的 agents 或 subagents 之间的从属关系的另行组合，
> 同时保留它们分别的工作区与权限。

这里的“来源”包括：

- 顶层 Session；
- in-process `spawn` 子代理；
- in-process `fork` 子代理；
- ACP、SDK、Codex、Claude Code 等外部代理；
- 普通 `ctx.sessions.fork()` 产生的新根；
- 未来可能的其他 provider。

### 1.2 三个来源场景（必须完整保留）

#### 场景 A：带团队的会话分支

用户手动“分支”一个会话，本质上只是复制一份会话。其已有子代理**不会跟随复制**，
导致带有团队的 agent 很难分支：

- 丢失所有子代理的上下文；
- 丢失团队/目录关系；
- 分支后可能没有可用的子代理，甚至表现为不能再新建子代理。

需要解决的是：**把带子代理的会话完整复制成一棵新的树**，而不是只复制父 Session。

#### 场景 B：重叠项目或代理间信息依赖

当用户构建了两个有重叠的项目，或一个代理需要另一个代理提供信息时，当前只能由用户
手动复制粘贴来交换。需要的是**受控的跨树信息通道**，而不是把两个 Session 合并。

#### 场景 C：上下文混乱后的“出芽繁殖”

当一个代理会话陷入上下文混乱，需要创建一个新代理继承必要信息并重新开始。当前无法
借助子代理与父代理之间便捷的信息交流，把子代理独立“出芽繁殖”为新的主代理。

需要的是：**从现有节点快照出一个新的独立根**，保留必要历史、工作区、预设和权限状态，
并让新根重新获得创建子代理的能力。原节点可以保留，形成分叉。

## 2. 需求清单

### R1 — 组合关系

支持把多个 agents/subagents 组织成用户定义的从属关系，独立于 DSH 原生树。
默认采用**严格森林**：每个节点最多一个 `reports-to` 上级，允许多个根。

### R2 — 保留工作区

每个节点保留自己的 `cwd` / 当前工作目录 / 工作区语义。组合操作不得把 Session
移动到另一个工作区，也不得改变已有进程的工作目录。

### R3 — 保留权限

每个节点保留自己的 sandbox mode、approval policy、permission preset、工具组合。
组合、克隆、出芽都不能静默放宽或收紧权限。

### R4 — 团队分支/克隆

能把一棵带子代理的会话树复制成新的树：

- 新树使用新的 Session id（克隆，不是原生迁移）；
- 保留源节点的必要会话上下文、cwd、preset、权限快照；
- 重建子代理目录和成员关系；
- 不复制运行中的 Activation、待处理 inbox、临时进程；
- 原树保持不变；
- 克隆结果必须明确标注“克隆/快照”，不能伪装成原节点。

### R5 — 受控跨树信息交换

支持在用户明确授权的组合边上交换信息，解决场景 B。要求：

- 不是原生 `send_message`，不改变原生树权限；
- 默认只对活着的本地 Session 开放；
- 冷 Session 如需恢复，必须显式管理 `AgentHandle` 生命周期；
- 外部/一次性代理不能后续对话；
- 每条边/每次投递可审计；
- 不能因为组合边存在，就静默授予中断、归档、Team 任务等权限。

### R6 — 出芽为独立根

能把一个子代理（及其可选子树）快照为新的顶层根，用于上下文混乱后的重启：

- 新根拥有新的 Session id；
- 保留必要历史、cwd、preset、权限状态；
- 新根重新获得委派能力（受深度/容量/preset 约束）；
- 原节点保留，除非用户另行归档；
- 明确区分“复制”与“移动”。

### R7 — 缓存友好（新增硬性原则）

**非必要不破坏 LLM 上下文缓存。** 具体见第 6 节。任何会改变请求前缀的设计
（新 system prompt、新工具、改 cwd、改 preset、改权限、把说明插到历史前面）
都必须有明确理由，并在 UI/文档中说明缓存影响。

### R8 — 模型表面尽量薄

默认不新增模型工具、不注入 prompt、不改变现有工具 schema。跨树 Bridge 如果
确实需要模型可调用，再单独评估“一个显式工具”的方案；不能假设零工具一定成立，
但也不能无理由扩大模型表面。

### R9 — UI 与既有插件共存

复用 DSH 右侧栏/会话头部的交互模式，但新插件必须与 `dsh-extraworkspace`、
`dsh-experimental-forge-bundle` 等共存，不能抢占或隐藏它们的入口。详见第 8 节。

### R10 — 本地、可恢复、失败保守

- 组合数据持久化，Host 重启后恢复；
- 存储失败时降级为内存状态并提示，不使整个插件崩溃；
- 不因 Session 暂时不可用而删除组合；
- 克隆/出芽失败不能留下半棵树或损坏原树。

### R11 — 明确身份与语义

用户必须能分清：

- 原生父节点（DSH 创建时的 parent）；
- 组合父节点（用户编辑的 reporting edge）；
- 原节点 vs 克隆节点；
- 活节点 vs 快照/不可用节点；
- 本地 Session vs 外部叶子。

### R12 — 仓库与交接

- 仓库继续使用 `dsh-combinagents`；
- 不包含个人路径、用户名、邮箱、令牌；
- 新增设计变更要更新本文档和 `AGENTS.md`；
- 未经用户要求不 push、不发布。

## 3. 设计原则

### P1 — 原生 lineage 只读

DSH 的 `parentSession`、`origin`、`delegationDepth`、catalog、Activation 都视为
只读事实。组合层不能改写它们。需要新关系时，创建新的 Session/新树，而不是伪造旧树。

### P2 — 组合层与执行层分离

- Composition 只表达“谁向谁汇报”；
- Clone 负责“复制出一棵新树”；
- Bridge 负责“跨树传递信息”；
- 三者不能混成一个隐式行为。

### P3 — 身份显式

任何克隆/出芽都必须显示“这是新 Session，基于某时某源快照”，并保留源 id 的只读引用。
不能让用户以为原 Session 被移动了。

### P4 — 权限不随组合边传播

组合边不是 capability。只有显式的 Bridge grant 才可能产生跨树投递权限；即使如此，
也不能自动获得中断、归档、Team 任务或 sandbox 扩权。

### P5 — 缓存默认优先

默认选择“追加”而不是“改写”；默认不新增 prompt/tool；默认保持 cwd/preset/route。
破坏缓存必须是显式、可解释的例外。

### P6 — 快照在静止边界

克隆只复制 durable 前缀，不复制运行中的回合、inbox、临时进程、容量槽。
使用 DSH 的 fork/seed 机制处理开放回合和闭合事件，不手工拼不平衡日志。

### P7 — 原树不被破坏

分支/出芽后原树继续可用。删除/归档原节点必须是用户显式动作，且不能由克隆流程自动完成。

### P8 — 失败保守

图操作原子化；存储损坏备份并跳过；克隆失败清理半成品；绝不因为一个节点消失而删除组合。

### P9 — UI 单一配置面

同一功能不要同时存在两个互相矛盾的入口。优先一个右侧栏 tab，会话头部按钮只负责打开它；
窄屏/全屏使用 DSH 既有 sidebar 表现，不另造一套弹窗逻辑。

### P10 — 可测试的负向保证

“没有写 header/cwd/policy”必须能通过测试断言，而不是只写在文档里。

## 4. DSH 约束与不可行边界

### 4.1 不能原生换父/换树

- `SessionHeader` 的 `parentSession`、`origin`、`delegationDepth`、`cwd` 是创建时元数据，
  没有公开 setter；
- `subagent/catalog` 是父会话拥有的追加式事件，没有删除/改父 API；
- `SubagentManager.rootOf()` 依赖活着的 Activation；只有 header 不够；
- 冷恢复沿 `parentSession` + 父 catalog 逐级校验，缺记录直接拒绝；
- `send_message`、`interrupt_agent`、Team、归档准入都跟随原生树；
- 换父等于给新祖先授予消息/中断权限，是安全边界，应由 DSH 核心提供审计操作。

**结论：第三方插件不能把已有 Session 原生迁移到另一棵树。**

### 4.2 fork 只复制一个 Session

`ctx.sessions.fork()` 复制一个事件前缀，不递归复制子 Session；`subagentCatalog`
投影会忽略继承来的旧 catalog（`seq < inheritedEventCount`）。所以分支不会自动带上
原团队。

需要注意：普通 fork 本身通常是新根，**不一定**“不能新建子代理”；如果分支来自子代理，
或 preset 没有委派工具、深度预算耗尽，才会表现为不能建子代理。实现时要分别诊断。

### 4.3 外部代理是叶子

ACP、SDK、Codex、Claude Code 等没有本地子 Session，不能后续对话、不能迁移、不能
被 Bridge 投递。UI 只能把它们作为可见但不可路由的叶子。

### 4.4 子代理权限继承父策略

子代理创建时继承的是**父代理**的 sandbox/approval 策略，approval 固定为 `never`；
不会自动复制另一个源 Session 的权限。克隆/出芽如果要保留源权限，必须显式重建并验证，
不能假设 DSH 自动完成。

### 4.5 其他约束

- 名字在兄弟间永久唯一，完整路径编码父链；迁移会改变寻址；
- 深度 `delegationDepth` 持久化，改变层级会影响 `maxDepth`；
- 容量 `maxActiveSubagents` 按原生树根共享；
- Activation 是进程本地的，没有跨 Host 租约；
- Team 是单树 + 共享 checkout，不跨树；
- Session format v4，header 是持久化格式的一部分，不能随意改写。

更多源码证据见 `docs/FEASIBILITY.md`。

## 5. 初步逻辑设计方案

### 5.1 三层模型

```
Composition Layer
  用户编辑的 reports-to 森林 + 展示快照
        |
        +-- Snapshot/Clone Layer
        |     从源树复制出新的 Session 树（新 id）
        |
        +-- Bridge Layer
              显式授权的跨树消息投递（不改变原生树）
```

### 5.2 Composition

- 存储：`combinagents` domain，`compositions` table，`per-record`；
- 一个根 Session 一份组合（phase 1 建议）；
- 节点：`sessionId`、label、kind（session/external）、source、provider、native parent、
  cwd 快照、permission preset 快照；
- 边：`reports-to`，严格森林；
- 操作：add/remove/rename/set-parent/set-title；
- 删除节点只删除图节点，子节点提升为根；不删除 DSH Session。

纯图模型已在 `src/graph.js` 实现，接手的代理应复用它，不要重写一套图逻辑。

### 5.3 分支/团队克隆

目标：把源组合中的一棵子树复制为新树。

建议流程：

1. 用户在组合图上选择“克隆这棵子树”；
2. 在源树的静止边界读取：
   - 源 Session 的 header；
   - 完整/必要的消息前缀；
   - 子代理 catalog；
   - preset、model 路由、cwd；
   - 可观察的权限状态；
3. 为新根创建新的 Session/Agent；
4. 按源 catalog 递归创建新的子 Session；
5. 用 DSH 的 subagent/activation API 重建新的 catalog/成员关系；
6. 克隆树中的每个节点标记 `cloneOf`、`snapshotAt`、`sourceCompositionId`；
7. 原树完全不动。

必须遵守：

- **不复制运行中的 Activation**：只复制 durable 前缀；运行中的 turn 由 DSH fork
  的闭合逻辑处理；
- **不复制 pending inbox**；
- **不假设 Team 任务自动跟随**：任务板属于源根日志；可以选择复制并重映射 owner，
  或明确从空任务板开始；
- **不自动复制权限**：需要显式重建，并提示缓存/权限影响；
- **新 id**：所有克隆节点都是新 Session id。

### 5.4 出芽为独立根

“出芽”是克隆的特例：只把选中的子代理（可选带其子树）复制为一个新的顶层根。

- 新根没有原生 parent；`origin` 不应伪装成 subagent；
- 保留必要历史/cwd/preset/权限状态；
- 新根可以重新创建子代理；
- 原节点保留，形成分叉；
- 若用户想“替换”，只能在验证新根后显式归档原节点。

### 5.5 跨树 Bridge

Bridge 是显式的、边级的、可审计的能力，不是 Composition 边的自动副作用。

Phase 1 可以先不做 Bridge；如果做，建议：

- 只对 `live` 本地 Session；
- 每条边有独立 `allowDelivery` 开关；
- 只允许 append 消息，不改 system prompt/tool schema；
- 使用 `agent.followup()` / `agent.steer()` 或 DSH 提供的等价安全入口；
- 冷 Session 恢复必须由插件持有 `AgentHandle`，并有超时/释放策略；
- 外部代理直接拒绝；
- 审计记录：谁、何时、从哪个节点、到哪个节点、消息摘要/长度、结果；
- 不自动授予中断、归档、Team 任务权限。

如果模型需要主动使用 Bridge，再评估新增一个显式工具；不能把 `send_message` 改写成
跨树工具，也不能让组合边隐式成为模型权限。

### 5.6 生命周期

建议状态：

```
discovered -> attached -> composed
                    |
                    +-> clone-preview -> cloning -> cloned / failed
                    |
                    +-> bridge-granted -> delivering -> delivered / rejected
```

所有变更按 composition 串行化；克隆任务可取消；失败清理半成品；原树只读。

### 5.7 数据建议

```
CompositionRecord
  id/rootSessionId/title/nodes/edges/createdAt/updatedAt

CloneRecord
  id, sourceCompositionId, sourceRootSessionId,
  newRootSessionId, snapshotAt, status,
  nodeMapping[{sourceSessionId,newSessionId,label,cloneOf}],
  cacheProfile (provider/model/preset/cwd fingerprint)

BridgeGrant
  id, compositionId, edgeId, fromNodeId, toNodeId,
  allowDelivery, createdAt, lastUsedAt

BridgeAudit
  id, grantId, fromSessionId, toSessionId,
  at, outcome, messageBytes, errorCode?
```

不要把 Bridge 授权写进 Session 事件；它是插件数据，不是会话历史。

## 6. 缓存友好设计（硬性原则）

### 6.1 先区分两类缓存

- **DSH session/projection cache**：克隆是新 Session，不复用原运行时状态；
- **LLM provider prompt/KV cache**：按请求前缀复用；前缀变化才失效。

### 6.2 基本规则

- **C1** Composition UI 不进入 prompt → 不影响缓存。
- **C2** Bridge 只允许追加消息 → 旧前缀保留，只计算新后缀。
- **C3** 克隆必须尽量保持 system prompt、工具 schema、provider/model/effort、
  preset、cwd、权限策略一致。
- **C4** 克隆/出芽的说明、handoff、组织关系文本必须**追加在历史末尾**，不能插入
  system prompt 或历史前面。
- **C5** 默认不新增模型工具、不新增 system prompt section、不新增 runtime context。
- **C6** 需要改 cwd/preset/权限时，必须显式标注“会破坏缓存”，并让用户选择。
- **C7** 每个克隆节点是独立缓存谱系；克隆 N 个节点不等于共享 N 个缓存。
- **C8** 使用 DSH 的 fork/seed 机制复制平衡前缀；不要手工拼开放 turn。
- **C9** provider 缓存命中不是保证：TTL、缓存键、路由、账户都可能影响；DSH 只能
  尽量保持前缀一致。
- **C10** 缓存测试要比较请求前缀，而不是只断言“复制成功”。
- **C11** DSH 的 time-context 是追加的 user message；它增加新后缀 token，但不会让
  更早的前缀失效。不要为了“更新时间”去改 system prompt。

### 6.3 克隆时的检查清单

1. 源和克隆的 `system/message` 是否字节一致？
2. 工具 schema 列表是否一致？
3. provider/model/reasoning effort 是否一致？
4. cwd 是否一致？
5. permission preset/sandbox mode/approval 是否一致？
6. 克隆说明是否只追加在末尾？
7. 是否使用了 DSH 的 fork/seed 闭合逻辑？
8. 是否新增了任何 prompt section/tool？

任何一项为“否”，都要在 UI 中记录缓存风险。

### 6.4 可测试方法

- 用 fake LLM adapter 捕获 `request/header`、system message、tool schemas、消息前缀；
- 对源节点和克隆节点计算规范化前缀指纹；
- 断言克隆首次请求的前缀在加入“克隆说明”前与源一致；
- 断言 Bridge 投递只追加，不重写旧消息；
- 不断言 provider 缓存命中率，只断言 DSH 侧前缀稳定性。

## 7. 工作区与权限保留

### 7.1 Composition 操作

- 只读 `session.header.cwd`、`workingDirectory.get(session)`、
  `sandboxPolicy.resolve({session})`、`permissionPresets.current(session)`；
- 不写 session header、不写 cwd、不写 sandbox/approval/permission 事件；
- 不调用 `registerWritableRoot` 或 Windows ACL；
- 不把“组合父节点”当成权限祖先。

### 7.2 Clone/出芽

- 复制 `cwd` 和当前工作目录语义；
- 复制必要的历史前缀；
- preset/model/工具集尽量保持一致（为了缓存和能力）；
- 权限必须显式重建并验证；不能假设自动继承源策略；
- 如果无法保留源权限，UI 必须说明新节点使用什么策略；
- 克隆不是“同一工作区的另一个句柄”，而是新 Session；文件系统共享不等于 Session 共享。

### 7.3 负向测试

对每个图/克隆操作断言：

- 没有对源 Session 追加任何事件；
- 没有 `working-directory/change`、`sandbox/mode`、`approval/policy`、
  `permission/preset` 写入；
- 没有 ACL/`registerWritableRoot`；
- 原树成员关系、catalog、Activation 不变。

## 8. UI 设计与兼容点

### 8.1 本会话原项目 `dsh-extraworkspace` 的 UI（可复用经验）

> 这里把“本会话原项目”理解为之前完成的 `dsh-extraworkspace`。如果你指的是另一个项目，
> 请让接手代理先更正本节，不要按错误前提实现。

原项目是“每会话额外工作区”插件，最终 UI 形态如下：

- **右侧栏 tab**：
  - tab id `@dsh-extraworkspace/extra`，kind `dsh-extraworkspace`；
  - 始终注册一个 guide entry；
  - tab 始终包含核心设置（添加/移除/启用切换/重试/修复权限）；
  - 当 Forge 活跃时，额外显示 Git 状态、额外 worktree 创建/移除、归档清理开关；
  - Forge 未启用时只隐藏 Git/worktree 区，不隐藏整个 tab。
- **会话头部按钮**：
  - 位于 `conversation.session.header.utilities`，order 12；
  - 点击调用 `ctx.sidebarRight.openTab('dsh-extraworkspace')`；
  - 右侧栏不可用时才回退到 inline modal；
  - **必须保留这个按钮**：曾经为了“统一到 Forge 页面”隐藏它，结果用户无法添加
    额外工作区，后来已回退。Forge 是否启用只影响 tab 内的 Git 区，不影响入口。
- **单一配置面**：
  - 头部按钮只负责打开 tab，不再维护一份独立配置；
  - modal 只是 fallback，embedded 模式无 backdrop/标题/关闭按钮；
  - tab、header、modal 的说明文案必须统一，不能出现“从头部面板添加”但实际只在
    tab 内提供表单这类矛盾。
- **客户端桥接**：
  - 一个同源 JSON 前缀路由 `/dsh-extraworkspace`；
  - `/bootstrap` 返回 token/version/platform/supported/forge；
  - 只接受 loopback，token 放在 `x-dsh-extraworkspace-token`。
- **Forge 兼容**：
  - 通过 `/bootstrap` 的 `forge` 标志判断；
  - Git/worktree 路由在 `ctx.get('forgePanel')` 不存在时拒绝；
  - 默认归档自动清理，`retainWorktreesOnArchive` 默认 `false`；
  - 不改变 Forge 的根工作区语义。
- **样式/可访问性**：
  - 仅使用 `--dsw-alias-*` 主题 token；
  - 中英文 locale 完整；
  - switch 使用 `role="switch"`/`aria-checked`；
  - modal 有 dialog/aria-modal/焦点陷阱/Escape/焦点恢复；
  - 窄屏/深色/浅色都要检查。
- **客户端形态**：
  - plain `window.__ModuleLoader__.load` factory；
  - 只使用共享 `react`/`react-dom`；
  - 客户端 bundle 会被页面缓存，改 `client.js` 后刷新页面。

这些是“原项目”的既有设计资产。新插件可以复用交互模式，但不要直接复制其
ACL/Forge/worktree 业务逻辑。

### 8.2 新插件建议 UI

- 一个右侧栏 tab：`@dsh-external/dsh-combinagents/composition`，
  kind `dsh-combinagents`；
- 一个会话头部按钮，打开该 tab；不要再造第二套配置；
- tab 内：
  - 标题、根 Session、刷新；
  - 组合树（严格森林）+ 来源徽章 + 原生父节点；
  - 节点详情：cwd、sandbox mode、permission preset、live/archived/external；
  - 添加节点（搜索 live/persisted sessions）；
  - 父节点选择/拖拽（先做可访问的 select，再考虑拖拽）；
  - “克隆子树”“出芽为根”“Bridge 授权”作为显式动作；
  - 显眼提示：组合边不改变原生 `send_message`/Team/归档权限；
  - 克隆动作显示缓存影响与“新 Session”警告。
- 窄宽度用垂直树/列表，不强制自由画布；全屏用 DSH sidebar 的 fullscreen 表现。
- 所有字符串进入 `dsh-combinagents` locale 命名空间。

### 8.3 与原项目/Forge 的潜在兼容点

1. **tab id/kind 冲突**：必须用独立 id/kind，不能复用 `dsh-extraworkspace`。
2. **头部按钮**：`conversation.session.header.utilities` 的 id 唯一，order 避开 12；
   不要隐藏原按钮（此前明确修正过：隐藏会导致添加额外工作区不可达）。
3. **guide entry**：两个插件的 guide 条目会同时出现；标题要短、可区分。
4. **右侧栏空间**：多个 tab/按钮会挤压；使用图标 + tooltip，窄屏下不要溢出。
5. **Forge**：不要在 Forge 未启用时假设 `forgePanel`；Git/worktree 相关能力必须 gate；
   Forge 管理根工作区，`dsh-extraworkspace` 管理额外工作区，新插件不应重定义两者。
6. **ACL/权限**：`dsh-extraworkspace` 会写 ACL/`registerWritableRoot`；新插件绝不能
   调用这些 API，否则会改变“工作区/权限只读”的承诺。
7. **worktree 所有权**：Forge 根 worktree、extraworkspace 额外 worktree 已有归属；
   新插件如果要显示/克隆，先确认归谁管理，不要重复创建/清理。
8. **存储/路由**：独立 storage domain、`/dsh-combinagents` 路由、token、locale、CSS 前缀。
9. **DSH 版本**：都按 `0.2.2-rc.3` 核对；升级后重新检查 sidebar/header/subagent 契约。
10. **客户端缓存**：两个插件都需刷新页面才能加载新 bundle；HMR 只在 watcher 运行时生效。
11. **模型工具**：原项目零新增工具；新插件 phase 1 也应默认零新增工具，避免工具
    schema 改变缓存前缀。
12. **Windows**：原项目的 ACL 逻辑是 Windows 专用；新插件的组合/克隆逻辑应尽量平台无关。

## 9. 技术方案建议

### 9.1 Host

- 硬依赖：`sessions`、`storageDomain`；
- 可选：`sessionQuery`、`subagents`、`workingDirectory`、`sandboxPolicy`、
  `permissionPresets`、`webServer`；
- 发现：`ctx.agents.list()`、`ctx.sessions.list()`、`ctx.sessionQuery.listSessions()`、
  `ctx.subagents.listDescendants()`；
- 观测：只读 header/cwd/policy/catalog/status；
- 变更：图操作串行化；克隆任务独立队列；
- 存储：`combinagents` domain，`per-record`，损坏备份跳过；
- HTTP：同源、loopback、token、body limit；不要用 package-private host.call。

### 9.2 Client

- plain Module Loader；
- 右侧栏 tab + header utility + guide；
- 主题 token、locale、可访问性；
- 不导入 Harness Client 包；
- 不渲染未授权的外部节点操作。

### 9.3 克隆 API 的待验证点

以下必须用真实 DSH 做 spike，文档不能替代验证：

- 冷 Session 如何用 `sessionQuery.readSession` 取前缀；
- 如何用 `ctx.agents.create` 的 `seed`/`meta` 创建新根，并挂载相同 preset；
- 新子节点是否应通过 `ctx.subagents.startActivation` + 自定义 provider 创建，
  还是可以直接 `agents.create` 后补 catalog；
- 如何在不写坏原树的前提下重建 `subagent/catalog`；
- 权限事件如何重建，是否会触发 `approval/policy` 的 `never` 固定；
- Team 任务板是否复制、如何重映射 owner；
- 克隆时如何用 DSH fork seed 关闭开放 turn。

## 10. 分期与验收

### Phase 0 — 脚手架（已完成）

- 纯图模型 + 13 个测试；
- 需求/可行性/架构文档；
- Git 初始化；
- inert bundle entry。

### Phase 1 — Composition 基础

- 存储、发现、图编辑、HTTP、右侧栏 tab、header 按钮；
- 只读展示 cwd/policy/source/native parent；
- 不新增模型工具；
- 验收：组合持久化、循环/重复拒绝、原 Session 无写入。

### Phase 2 — Clone / 分支 / 出芽

- 子树快照；
- 新树创建；
- 缓存前缀检查；
- 克隆标记；
- 失败清理；
- 验收：带 2 个子代理的树可克隆成新树，原树不变，前缀指纹符合预期。

### Phase 3 — Bridge

- 边级授权；
- 只对 live 本地 Session；
- append-only；
- 审计；
- 验收：跨树消息可送达，原生树权限不变，外部节点被拒绝。

### Phase 4 — 加固

- 冷恢复/容量/Team 任务；
- UI 可访问性、窄屏、深色；
- DSH 版本升级检查；
- 文档与迁移。

## 11. 风险与开放问题

### 风险

- **用户预期**：可能把“组合父节点”误解为原生父节点；
- **克隆身份**：用户可能期望同一 Session 被移动，但实际只能新 id；
- **缓存**：即使前缀一致，provider 也不保证命中；克隆会增加冷 prefill；
- **权限**：源权限重建可能改变策略/缓存；
- **Team 任务**：owner id 需要重映射，不能简单复制；
- **外部代理**：不可恢复，UI 必须明确；
- **DSH 版本漂移**：subagent/session 契约变化快。

### 必须确认的问题

1. 克隆产生**新 Session id** 是否可接受？（原生迁移不可行）
2. 分支是复制整个根树，还是只复制选中的子树？
3. Team 任务板：复制并重映射，还是从空板开始？
4. Bridge 是否需要模型可调用？如果需要，是否接受新增一个显式工具？
5. 一个 Session 是否可以出现在多个组合中？
6. 组合归属：按 root session，还是 profile/workspace？
7. 出芽后原节点默认保留还是提示归档？
8. 是否允许“克隆时改 cwd/preset/权限”？（会破缓存，应默认禁止）

## 12. 交接清单

新代理接手后：

1. 先读本文、`docs/FEASIBILITY.md`、`docs/ARCHITECTURE.md`、`AGENTS.md`；
2. 不要尝试改 `SessionHeader.parentSession` 或伪造原生 catalog；
3. 不要直接照搬 `dsh-extraworkspace` 的 ACL/Forge/worktree 业务；
4. 先做 Phase 1 或先做克隆 spike，二选一，但不要同时展开；
5. 任何新 prompt/tool 都要先过第 6 节缓存检查；
6. 任何组合/克隆操作都要有“原 Session 无写入”测试；
7. 更新文档，不要只改代码；
8. 未经用户要求不 push、不发布。

## 13. 术语

| 术语 | 含义 |
|---|---|
| 原生 lineage | DSH 的 parentSession + catalog + Activation 形成的树 |
| Composition | 本插件的用户编辑 overlay 森林 |
| reports-to | 组合层从属边 |
| Clone | 用新 Session id 复制出的树/节点 |
| Bud / 出芽 | 把子代理快照为新根 |
| Bridge | 显式授权的跨树消息通道 |
| Prefix | LLM 请求中 system + tools + 历史消息的缓存前缀 |
| Snapshot | 某一时刻的 durable 会话前缀，不含运行态 |

## 14. 参考

- `docs/FEASIBILITY.md` — DSH 源码核对、不可行边界、方案对比；
- `docs/ARCHITECTURE.md` — 组合层技术架构、HTTP、UI、验收；
- `AGENTS.md` — 工作契约与验证清单；
- `src/graph.js` — 已实现的纯图模型；
- `tests/graph.test.mjs` — 13 个图不变量测试；
- 同会话原项目 `dsh-extraworkspace` 的 UI/Forge 兼容经验（第 8.1 节）。
