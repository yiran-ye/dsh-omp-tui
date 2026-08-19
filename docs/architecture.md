# 架构

## Bundle 边界

`package.json#dsh.bundle.patch` 让 DSH 在 `@deepseek-ai/dsh-base` 之上应用
`cordis.patch.yml`。该 patch 只插入 startup、主 TUI、session-stats 和
agent-presets，并禁用会干扰终端绘制的 HMR。它不挂载 Host、ApiProxy、HTTP、
Web Runtime、Browser 或 headless runner。

主插件的强制注入只有创建/恢复 Agent 必需的 `agentDefaultModel`、`agents` 与
`sessions`。Tools、Approval、User Questions、Permission Presets、Compaction、
Projection 和 Agent Presets 均通过 `ctx.get()` 可选发现。

## 数据流

```text
Editor submit
   │
   ├─ idle ───── Agent.followup(UserMessage)
   └─ running ── Agent.steer(UserMessage)
                       │
                       ▼
                 Session Event Log
                 ├─ initial: agent.session.events
                 └─ live: ctx.on("session/event")
                       │ seq 去重
                       ▼
                    TuiStore
                       │ immutable snapshot
                       ▼
                 pi-tui components
```

`TuiStore` 不订阅 Cordis。`AgentSessionBinding` 是唯一 Event Adapter，在 replay
期间缓存并排序可能重叠的实时事件，再依靠 `seq <= lastSeq` 丢弃重复事件。
流式输出只保留每个 block 当前累积值；最终 `assistant/message` 替换临时块。

Transcript 投影的是 append-only Session Event Log，而不是提供给模型的 ordered
surface。Compaction 的 `surfaceOp: { op: 'replace' }` 只改变模型上下文，TUI
不会删除被遮蔽的历史；新 checkpoint 仅作为紧凑的 injected-context 记录追加。

## Agent 生命周期

1. 等待 Cordis Loader 完成。
2. 读取 `agentDefaultModel.currentSelection()`。
3. 新 Session 可解析/挂载 Agent Preset；恢复 Session 调用正式
   `agents.resume()`。
4. `setup(agentCtx)` 安装 Model Selection，并为新 Session 挂载 Preset。
5. 等待 `agent.whenIdle()`，绑定历史与实时事件，挂载 `TuiMainScreen`。
6. shutdown 依次取消运行、等待 idle、flush、解除监听、停止 TUI、dispose
   Agent，最后通过 `appExit` 请求退出。

`/clear` 使用相同清理顺序后 `agents.create()` 一个新 ID，Store 与 Editor 对象
保持存在，因此输入历史不丢失。

`start`、`/clear` 与 shutdown 共用一个生命周期串行门。shutdown 会先同步标记
closing，使正在清理的 `/clear` 不再 attach 新 Agent；Handle 与 Binding 按同一
次 ownership 取走并释放，避免并发切换覆盖未受管理的 Agent。

## Tool Presentation

`ToolPresenter` 首先解析持久化 call arguments，然后调用工具声明的
`presentCall()`/`presentResult()`。支持 terminal、diff、read、search、web 和
generic。任何缺失或 presenter 异常都回退到通用卡片；Transcript 结果行数有
上限，完整内容留给 Tool Detail Overlay。

## 人机交互

`InteractionQueue` 统一串行化 Approval 与 User Questions。Cordis
`approval/request` waterfall 只处理当前根 Agent；Question 通过正式
`userQuestions.registerProvider()` 注册。Overlay 完成、跳过、AbortSignal 或
shutdown 都会显式 settle Promise，不留下等待中的 Agent。

## 终端模型

`ProcessTerminal + TuiMainScreen` 使用主屏缓冲区和差量绘制。`TerminalRestore`
幂等关闭 synchronized output、bracketed paste 和 keyboard protocol，恢复 raw
mode 与光标；`ProcessSafety` 覆盖 SIGINT/SIGTERM/SIGHUP、未捕获异常、Promise
rejection 和流断开，且正常路径不直接调用 `process.exit()`。
