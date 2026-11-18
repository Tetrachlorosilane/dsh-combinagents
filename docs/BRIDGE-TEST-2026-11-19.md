# 组合创建、子代理与桥通信实机测试（2026-11-19）

- 对象：运行中的 DSH `0.2.2-rc.5` Desktop Host，
  Web GUI `http://127.0.0.1:57009`，插件已安装于 `desktop` profile
- 当前 lead 会话：`<lead session>`（为避免把用户会话 id 提交到仓库，报告省略具体值）
- 方式：通过 `/dsh-combinagents` HTTP bridge 创建并检查组合；通过 DSH `workflow`
  启动原生 spawn 子代理；通过插件工具调用 `subagent` / `subagent_fork` /
  `send_message` / `list_agents`；只删除本次添加的 external 占位和 task，
  未删除任何 DSH session
- 约束：token 未打印；未修改 DSH `SessionHeader`、catalog、cwd、sandbox 或权限策略

> 更新（2026-11-19 02:xx）：Host 已重启到 `127.0.0.1:64806`，加载了
> `exec.arguments` 修复。持久 spawn/fork、`send_message`、`wait_agent` 已复测
> 通过（见第 6 节）。真实 one-shot 外部 provider 仍未挂载，见第 4 节。
> 第 3 节保留的是**重启前**的失败记录，用于说明 A-11。

---

## 1. 组合创建与 bridge 控制面

通过 bridge 为当前 lead 会话创建组合，结果：

| 操作 | 结果 |
|---|---|
| `GET /bootstrap` | 200 |
| `GET /summary?sessionId=` | 200，`compositionNodes: 0` |
| `POST /create` | 200，1 node |
| `GET /state?sessionId=` | 200，1 node / 0 edge，`storage: durable` |
| `GET /summary`（创建后） | 200，`compositionNodes: 1` |
| `GET /sessions` / `/titles` | 200 |

随后原生 `workflow` 探针成功执行（返回 `WORKFLOW_OK`），并产生一个
`provider: spawn` 的原生子级。插件的 `subagent/start` 监听把它自动镜像进了
组合：

- `/state`：2 nodes / 1 edge；
- 子级 `mode: continuable`，`source: subagent`，`inactive`；
- 新 edge 的默认 grant 为 `allowMessage: false, allowInterrupt: false`；
- `GET /external?rootSessionId=`：`available: true`，native count 1，0 leaves；
- `GET /summary`：`compositionNodes: 2`，`nativeSubagents: 1`；
- 用**子级 session id** 调 `/state?sessionId=` 返回 200，说明 member 解析可用；
- `list_agents` 返回 2 行：lead（running）和该 native child（inactive），
  description 带 `native child of …; mode=continuable`。

这证明“原生 spawn 子代理 → catalog → 自动镜像 → composition membership”
链路可用，且 bridge 能读到。

---

## 2. bridge 写路径与保护

| 操作 | 结果 |
|---|---|
| `POST /set-grant`（native edge，`allowMessage: true`） | 200；`/grants` 返回该 edge true |
| `POST /add-external`（挂在运行中的 root 下） | 409 `AGENT_BUSY`，符合 busy guard |
| `POST /add-external`（作为独立 root） | 200，external node `mode: external` |
| 同一 `externalId` 再 POST 一次 | 200，external 数量仍为 1（幂等） |
| 存在 external 时 `list_agents` | 仍 2 行，external 被过滤（符合设计） |
| `POST /rename-node` external | 200 |
| `POST /remove-node` external | 200，节点回到 2 |
| `POST /create-task` | 200，revision 1，owner 指向 root |
| `POST /update-task` start | 200，`in_progress` |
| `POST /update-task` delete | 200，任务消失 |
| `POST /sync-native` ×2 | 200 / 200，节点数仍为 2（不重复） |
| `POST /remove-node` root `cascade` | 403 `ROOT_PROTECTED`，节点数不变 |

`/grants`、`/tasks`、`/external`、`/summary`、`/titles` 均为 200。
**HTTP bridge 控制面可用**，包含认证、只读观测、grant、external 幂等、
task 生命周期、sync 幂等和 root 保护。

---

## 3. 重启前的插件工具失败（A-11）

> 本节记录修复前 Host 的错误；02:xx 重启后的复测结果见第 6 节。

### 3.1 持久模式（spawn / fork）

调用：

```text
subagent({ description: "Bridge persistence probe", prompt: "Reply ..." })
subagent_fork({ description: "Bridge fork probe", prompt: "Reply ..." })
```

两者均返回：

```text
Error: Cannot read properties of undefined (reading 'provider')
```

`send_message({ agent: "<native child id>", message: "..." })` 返回：

```text
Error: Cannot read properties of undefined (reading 'agent')
```

`list_agents` 正常返回，因为它的 handler 不读参数。

### 3.2 根因

DSH `tools/execute` 的 live 事件字段是 `exec.arguments`：

```ts
// @deepseek-ai/dsh-tools/src/contracts.ts
interface ToolExecutionInput {
  readonly name: string
  readonly arguments: unknown
  readonly agent?: Agent
  readonly signal: AbortSignal
}
```

`ToolDefinition.execute(args, exec)` 才把 `arguments` 作为第一个参数交给工具。
旧 `src/controls.js` 拦截器使用 `definition.execute(exec.args, exec)`，
live `exec.args` 为 `undefined`：

- `subagent` 在 `args.provider` 处失败；
- `send_message` / `interrupt_agent` 在 `args.agent` 处失败；
- `wait_agent` 在 `args.timeout_ms` 处失败；
- `list_agents` 不读参数，所以是唯一正常工作的原生名工具。

测试以前直接调用 `definition.execute(args, exec)`，没有经过 live
`tools/execute`，所以 158 个测试全绿仍漏掉了这个真实问题。

### 3.3 已修复并复测

`src/controls.js` 现在使用：

```js
const args = exec.arguments ?? exec.args
```

并新增 `interception forwards the live exec.arguments shape to tool bodies`。
修复前 Host 未加载这段代码。重启后的复测已完成：`subagent` / `subagent_fork`
均成功，`send_message` 得到 `messageId`，`wait_agent` 收到子级 `BRIDGE_*_OK`
回执（第 6 节）。

---

## 4. 一次性（one-shot）模式

DSH 的 one-shot 是**外部执行**的生命周期模式（如 ACP / Codex / Claude Code），
不是本地 `spawn` 或 `fork` 的选项：

- 当前 standard profile 的 `subagent` / `subagent_fork` 都是
  `provider: spawn` / `fork`，`backgroundMode: continuable`；
- `subagent_codex`、`subagent_claude_code` 两行在
  `.agent-presets/router-standard/agent.cordis.yml` 中是 `disabled: true`；
- `profiles/desktop/cordis.patch.yml` 没有挂载外部 subagent provider。

因此**本 profile 无法派发真正的 one-shot 外部子代理**。可测试的只有
external/one-shot 占位语义：

- `/add-external` 接受 `mode: external` 占位；
- `list_agents` 过滤该占位；
- external 节点没有本地 session，`send_message` 在修复后会以
  `TARGET_EXTERNAL` 拒绝，不能作为 follow-up 目标；
- `remove-node` 只删除 overlay，不删除任何 session。

如果必须做真实 one-shot 派发，需要在**复制出来的 preset** 中启用
`subagent_codex` 或 `subagent_claude_code`（并配置对应 provider/凭据），
不能直接在当前 standard 会话里改。

---

## 5. 判定

| 能力 | 实机结果 |
|---|---|
| HTTP bridge（bootstrap/token/Host/Origin） | **可用** |
| 创建组合、state/summary/grants/tasks/external | **可用** |
| external 占位幂等、sync-native 幂等 | **可用**（本轮修复已加载） |
| 原生 workflow spawn | **可用**，`WORKFLOW_OK` |
| 原生子级自动镜像到组合 | **可用**，mode continuable，edge 默认 deny |
| 插件 `subagent` / `subagent_fork` 派发持久子级 | **重启后可用**：spawn/fork 均成功 |
| 插件 `send_message` / `wait_agent` | **重启后可用**：messageId + 子级回执 |
| 插件 `interrupt_agent` | 本次未对运行中的子级做中断；对 inactive 目标按设计返回 `TARGET_NOT_LIVE` |
| 真实 one-shot 外部子代理 | **本 profile 不可用**：provider 未挂载，相关工具行 disabled |
| external/one-shot 占位语义 | **可用**：可添加/过滤/改名/移除，不能 follow-up |

结论：**bridge 控制面完全可用；当前阻塞的是 live execution interception 的
参数形状，而不是 bridge。** 修复后重启 Host 即可复测 composed subagent 与
send_message；one-shot 需要单独启用外部 provider。

---

## 6. 重启后复测（02:xx，端口 64806）

Host 重启后，同一 lead 会话的组合从存储恢复（原有 2 nodes / 1 edge）。
本轮新增：

1. `subagent` 启动持久子级 `agent-2`，返回 `started subagent agent-2`；
   completion notice 为 `BRIDGE_PERSISTENT_RETEST_OK`。
2. `send_message({ agent: "agent-2", ... })` 返回 `message delivered`；
   `wait_agent` 返回 `{"timedOut":false}`，通知为
   `BRIDGE_FOLLOWUP_RETEST_OK`。
3. `subagent_fork` 启动 `agent-3`，返回 `started subagent agent-3`；
   completion notice 为 `BRIDGE_FORK_RETEST_OK`。
4. 对 `agent-3` 再次 `send_message`，`wait_agent` 收到
   `BRIDGE_FORK_FOLLOWUP_OK`。
5. `list_agents` 返回 root + 3 个 continuable 子级；`/state` 为
   4 nodes / 3 edges；`/grants` 为 3 项。
6. 新 delegation edge 由 auto-grant 得到
   `allowMessage: true, allowInterrupt: true`；旧的 workflow 子级 edge 仍是
   之前手工设置的 `allowMessage: true, allowInterrupt: false`。
7. `/external` 返回 `available: true, count: 3, leaves: 0`；
   `/summary` 为 `compositionNodes: 4, subagents: 3, nativeSubagents: 3`。
8. 再次添加 external 占位（作为 root）：
   - 同一 `externalId` 两次 POST，external 仍只有 1 个；
   - `list_agents` 仍只显示 root + 3 个 continuable 子级，external 被过滤；
   - `send_message` 指向该占位返回
     `the target is an external placeholder; it has no local session`；
   - `/remove-node` 后节点回到 4，external 归零。

**结论（复测）**：A-11 已生效；持久 spawn、fork、`send_message`、`wait_agent`
的端到端链路可用。本次未对运行中的子级触发 `interrupt_agent`，对 inactive
子级调用按设计得到 `TARGET_NOT_LIVE`。

### 本次清理

- 删除了测试用 external 占位和 task；
- 保留当前 lead 组合（root + workflow 子级 + `agent-2` + `agent-3`，4 nodes）；
- 未删除任何 session，未改 cwd/policy。
