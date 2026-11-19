# dsh-combinagents

[English](README.md) | **简体中文**

[![dsh-plugin topic](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)

一个面向 DSH（DeepSeek Harness）Agent 与 Subagent 的**用户自有汇报组合**。

DSH 原生已经为每个 subagent 固定了 parent。本插件在此基础上增加一层可编辑的组合关系：由你决定谁向谁汇报，而不改变原生 subagent tree。组合只是 overlay，不会移动会话、重写 native parent，也不会改变会话的 workspace、sandbox 或权限策略。

> **兼容性：** 适用于 desktop/web profile 的 DSH `0.2.2-rc.5`。这是一个未发布到 npm 的本地插件 bundle，不是从 registry 安装的 npm 包。需要 Node.js 22 或更新版本。

本项目属于 [dsh-plugin](https://github.com/topics/dsh-plugin) 话题。

## 你能得到什么

- 右侧栏的 **Agent composition（Agent 组合）** 页面。
- 会话 header 中独立显示节点数的 chip。
- 添加本地会话或外部 Agent、重命名节点、设置 **Reports to（汇报对象）**。
- 逐边控制 **消息** 与 **中断** 权限。
- subagent 启动时自动镜像到组合。
- 用 **Sync native agents** 导入未镜像的 native 后代。
- 克隆整棵树，或把某个节点 bud 成新的独立 root。
- 插件自有的任务板，与 DSH Team 分离。
- 模型工具仍使用原生名称和 schema，但执行走组合逻辑。
- 跨 profile 收敛：另一个 DSH profile 修改组合后，不需要重启 Host 即可看到。

## 它不做什么

- **不会**在 DSH 原生层面重新挂接（re-parent）已有会话。
- **不会**在删除节点时删除或改写 DSH 会话。
- **不会**扩大 sandbox、permission preset 或 approval policy。
- **不会**合并会话，也不会把会话移动到另一个 workspace。
- **不是**跨主机、多用户服务；它是本地 profile 功能。

可以把它理解成原生 subagent tree 旁边的一张可编辑组织图，而不是替代 native tree。

## 环境要求

- DSH `0.2.2-rc.5`，desktop/web UI。
- Node.js 22 或更新版本。
- 使用 **standard** preset（或任何保留以下 native delegation 插件的 preset）：
  - `tool-subagent-control`
  - `tool-subagent`
  - `tool-subagent-fork`
- Profile 需要提供 `sessions`、`storageDomain`、`subagents` 和 sidebar-right client UI。缺少可选服务时只会少显示个别字段，不会让整个页面不可用。

本插件可以与其他 tool 插件共存。它保留 native tool definition，只拦截下面列出的六个工具的执行路径。

## 安装

这个仓库是 DSH **bundle**（`package.json` 中有 `dsh.bundle.patch`），不是 npm registry 包。

1. 把 checkout 放在稳定的本地目录。
2. 在你的 DSH profile 中把它注册为本地 bundle。使用当前 DSH 版本的 Plugin Manager bundle 安装功能，或在 profile 中添加等价的本地 package link。
3. 确认 profile 条目为启用状态：

```yaml
- id: dsh-combinagents
  config:
    autoGrantDelegatedEdges: true
    # 仅当 JSONL session root 不是 $DSH_HOME/sessions 时需要
    # sessionRoot: /absolute/path/to/sessions
  disabled: false
```

4. 保留 native delegation 插件。**不要**使用会移除这些插件的旧 `composed` preset；没有 native 定义时，本插件就没有可拦截的执行路径。
5. 重启 Host，然后刷新 GUI。

Host 重启后，请打开一个 **standard** 会话。旧 composed preset 创建的会话会保留旧 preset；它们会得到兼容 fallback，但建议新开 standard 会话。

如果找不到页面或 header chip，请确认 profile 中插件已启用，并在 Host 重启后刷新页面。

## 快速开始

1. 打开一个普通的 standard 会话。
2. 从右侧栏或 header chip 打开 **Agent composition**。
3. 如果该会话还没有组合，点击 **Create composition**。
4. 点击 **Add a session**，选择另一个会话；设置它的 **Reports to** 父节点，或保持为 root。
5. 在边的 **Details** 中允许消息或中断。新手动连接默认允许消息，中断默认关闭，需要显式开启。
6. 正常使用 `subagent` 或 `subagent_fork` 启动子代理。子代理会自动镜像到组合，并带上 native parent 和自动授权的 delegation edge。
7. 如果有 native 后代没有出现，使用 **Sync native agents**。

一个会话最多属于一个组合。把已在其他组合中的会话加进来时，它的子树会移动；如果源组合还剩下其他 root，会重新指定一个本地 root 持有者。被移动的子树保留内部 grant；新的边界 edge 继承旧的入边 grant，显式 deny 不会被重置为允许。普通 DSH fork 是新 root，不会仅凭 `parentSession` header 继承源组合的成员关系。

## 界面说明

| 操作 | 作用 |
|---|---|
| Add a session | 把已有 DSH 会话添加为组合节点 |
| Add external | 添加外部/非本地执行的占位节点 |
| Reports to | 设置父节点；选择 `No parent` 即成为 root |
| Rename | 修改组合中的节点标签，不改 DSH session title |
| Message / Interrupt grants | 允许沿该组合路径发消息或中断 |
| Sync native agents | 导入尚未镜像的 native 后代 |
| Clone whole tree | 创建独立的新树，源树不变 |
| Bud as new root | 把某节点及其子树克隆为新的 root |
| Show one-shot agents | 显示默认隐藏的一次性节点 |
| Teams | 选择 lead 与连通成员创建 Team；任务板和任务工具限定在这组节点内 |
| Shared tasks | 原生形状的任务板：创建、列表、读取、认领/释放、编辑、依赖、重派、完成、重开、删除 |
| Session cleanup | 预览孤儿克隆会话和一次性占位，可展开首条用户消息/最后消息摘要；删除是独立的确认步骤 |
| Open conversation | 打开本地会话；外部节点不提供 |

节点会显示 `live`、`saved`、`archived` 状态，以及 native parent、workspace、sandbox、permission preset、agent preset 和 lifecycle mode（如果可用）。Tab 支持上下滚动；**添加会话** 和 **添加任务** 使用相同的就地展开面板，均提供 **取消**；会话选择器也支持 Escape 关闭。

页面默认过滤 **one-shot** 节点；打开 **Show one-shot agents** 后才会显示。External 节点是占位符，不一定是 one-shot，因此默认仍显示。

## 模型工具

本插件不注册 native 工具的 shadow copy，而是注册一个 `tools/execute` 执行拦截器。以下六个名称的 native definition 保持不变，因此模型看到的 name、description、parameters、output schema、presentation、prompt guidance 和 restrictions 都是原生的；只有执行路径使用组合：

| 工具 | 本插件中的行为 |
|---|---|
| `list_agents` | 列出可继续的组合节点，description 中包含 `mode=` |
| `send_message` | 按组合边和授权发送；拒绝 one-shot 目标 |
| `interrupt_agent` | 按组合祖先/授权规则中断；可中断 live one-shot |
| `subagent` | 启动 native 子代理，镜像并自动授权 |
| `subagent_fork` | 同上，使用 fork provider |
| `wait_agent` | 原生 caller-inbox 等待语义 |

插件还在组合自有任务板上提供 **Team 形状的任务 API**。当 profile 未挂载原生 Team 服务/工具时，注册 `team_task_create`、`team_task_list`、`team_task_get`、`team_task_update`，字段、动作、CAS revision、依赖、ready 和 write-scope warning 与原生 Team 任务工具一致。Team 是一组连通的组合节点；选择 lead 会预选其子树，成员可继续取消。调用者属于某个 Team 时，这些工具限定在该 Team 的任务板与成员内。它们只写插件任务板，不写原生 Team 状态；挂载 Agent Teams 时原生工具优先，不注册这些别名。`composition_task` 保留为旧版单工具聚合入口。Native `list_subagent_models` 和其他 unique tool 不受影响。

`list_agents` 默认不列出 **one-shot** 和 **external** 行，与 native 的 continuable 列表一致。One-shot 目标不能接收 follow-up。由于 native output schema 没有单独的 `mode` 字段，lifecycle mode 被写进行 description。

### Team 与任务板

Team 是**一组连通的组合节点**，不是原生 Agent Team。在组合 tab 中选择 lead
会预选其子树，然后通过复选框增删成员。服务端拒绝不连通集合和与已有 Team
重叠的集合。Team membership 存在插件 domain 中，重启 Host 后仍保留，且不写
原生 Team 状态。

`Shared tasks` 任务板跟随当前 Team：

- **Composition board** 只显示没有 Team 的任务（`teamId: null`）；
- 选中 Team 后只显示该 Team 的任务；
- 删除 Team 会删除其 scoped tasks，但不会删除组合节点或 Session；
- clone/bud 会复制成员节点被包含的 Team 定义，并重映射任务的 `teamId`。

未挂载原生 Agent Teams 时，四个 Team 形状工具自动使用调用者所属 Team：

| 工具 | 作用域 |
|---|---|
| `team_task_create` | 在调用者 Team 的任务板创建；不在 Team 时用组合任务板 |
| `team_task_list` | 按 status/owner/unowned/ready 过滤，返回原生形状分页 |
| `team_task_get` | 读取当前作用域的一个任务 |
| `team_task_update` | CAS 动作：claim、release、edit、set_dependencies、complete、reopen、reassign、delete |

挂载原生 Agent Teams 时原生工具优先，插件不注册这些别名。这是 overlay 层的
功能替代，不是原生 Team，也没有共享 checkout。实机验证见
[`docs/TEAM-TEST-2026-11-19.md`](docs/TEAM-TEST-2026-11-19.md)。

### 生命周期模式

组合节点沿用 native 的生命周期区分：

| Mode | 含义 |
|---|---|
| `continuable` | 可以继续对话、接收后续消息的长期子代理 |
| `one-shot` | 终态执行，不能 follow-up |
| `external` | 没有本地会话的外部执行 |
| `unknown` | 旧记录或尚未同步的记录 |

**名字不是生命周期模式。** 不显式指定 name 的子代理仍会得到自动生成的 `agent-N` 名字，并且仍可以是 continuable。使用 **Sync native agents** 从 native catalog 刷新 mode。

## 跨 profile 一致性

数据存放在 DSH home 下，因此两个 profile 可以打开同一份组合数据。每个 Host 都有自己的 storage-domain 内存快照。本插件让它们收敛：

- durable composition 或 policy 写入后，更新一个小的 `.revision` marker。
- 读端发现 marker 变化时重新打开 storage domain，并重建 session membership。
- 组合 mutation 使用跨进程 `.mutation.lock`，避免两个 profile 互相覆盖 read-modify-write。
- 页面可见时每 3 秒轮询 `/state`，header chip 每 5 秒轮询 `/summary`。

这是**最终收敛**，不是同步分布式数据库。旧版本插件写入时不会发布 marker；使用非默认 storage 后端目录时，需要配置 `storageDir`。

## 安全与权限边界

- Overlay 不会写 DSH `SessionHeader`、native `subagent/catalog`、cwd、sandbox policy 或 permission preset。
- 组合边表示组织关系。插件的 `send_message` 和 `interrupt_agent` 执行使用组合授权，但不会绕过 native session policy。
- 同一 native tree 内优先使用 native relay；live 跨树目标使用组合 relay。
- 跨 workspace 且没有 full permission 时，会请求 approval；只有 `allowed-once` 才继续。
- 每次 delivered、denied 或 approval-denied 操作都会写入 audit。
- External 节点不能接收 follow-up。
- 删除节点只删除 overlay，不删除 DSH 会话。
- **Session cleanup** 是唯一会删除会话的操作：只删除非 live、无组合归属、经用户明确确认的孤儿克隆会话和一次性占位；默认操作 `$DSH_HOME/sessions` 下的 JSONL session 目录，自定义 root 用 `sessionRoot`。它回收的是 session 日志目录，共享 attachment/cache 文件不会删除。此操作不可撤销。

## 常见问题

| 现象 | 检查 |
|---|---|
| 六个原生名工具仍按 native 行为运行 | 插件是否启用？profile 是否保留 native delegation rows？安装后是否重启过 Host？ |
| 找不到 `composition_*` 工具 | 这些别名已按设计删除；请使用原生名工具加 `composition_task`，未挂载原生 Agent Teams 时还有 `team_task_*`。 |
| `NOT_IN_COMPOSITION` | 先为当前会话创建组合；或从 top-level agent 使用 `subagent`。 |
| `AGENT_BUSY` | 受影响的 agent 或其组合祖先/后代正在运行，等它结束。 |
| `another DSH profile is changing the composition` | 另一个 profile 持有 mutation lock，稍后重试。 |
| `STORAGE_UNAVAILABLE` | Domain 重新加载失败；读取保留最后一次内存快照，写入 fail-closed。重启 Host。 |
| `storageMemory` 警告 | Storage domain 未能打开；修改只在 Host 重启前有效，检查 DSH storage backend。 |
| 看不到某个 one-shot 代理 | 默认隐藏；打开 **Show one-shot agents**，必要时先 **Sync native agents**。 |
| 另一个 profile 的树看起来是旧的 | 等待 3 秒轮询、刷新页面，或确认两个 profile 都运行当前版本。 |
| 没有页面 | 确认插件和 client UI 已启用，Host 重启后刷新页面。 |

## 限制

- 一个会话只能属于一个组合；组合是严格的 `reports-to` forest。
- 不提供 native re-parenting，也不合并会话。
- 标签是用户可见文本，可能重复；重复标签会让 `send_message` 的目标选择有歧义。
- 不改变会话的 workspace、sandbox、permission preset 或 approval policy。
- 任务板和 Team 都是插件数据，不是 DSH Team 状态。Team 是连通 overlay，不是原生 Agent Team，也没有共享 checkout。
- 后续 reparent 可能改变 Team 的图结构；如果已有 Team 与当前结构不再匹配，请重建 Team。
- 在超大 transcript 下，超大 archived 组合的周边会话 UI 仍可能绘制很慢；bridge 本身不是瓶颈。
- 旧 composed 会话在迁移到 standard preset 前使用 fallback tool definitions。
- Native request-prefix fingerprint 尚未纳入验收测试。

## 开发

```bash
npm test
npm run check
```

测试只使用 Node 内置 test runner；没有 build 步骤，也没有 runtime dependency。

```text
index.js                 Host 入口与 bridge 生命周期
client.js                右侧栏页面、header utility、计数 chip
src/graph.js             纯组合图模型
src/clone.js             纯 clone/bud planner
src/clone-manager.js     Clone/bud host adapter
src/store.js             Storage domain、revision reload、mutation lock
src/discovery.js         Session 与 native catalog 发现
src/manager.js           串行 mutation 与 grant
src/http.js              Loopback JSON bridge
src/controls.js          Native tool 执行拦截
```

更多文档：

- [架构说明](docs/ARCHITECTURE.md)
- [产品交接说明](docs/HANDOFF.md)
- [DSH 可行性分析](docs/FEASIBILITY.md)
- [Standard profile 配置与迁移](docs/COMPOSED-PROFILE.md)
- [Clone/bud spike](docs/CLONE-SPIKE.md)
- [贡献者工作约定](AGENTS.md)

## 许可证

MIT，详见 [LICENSE](LICENSE)。
