# 架构

## Bundle 边界

`package.json#dsh.bundle.patch` 让 DSH 在 `@deepseek-ai/dsh-base` 之上应用
`cordis.patch.yml`。该 patch 只插入 startup、主 TUI、session-stats 和
agent-presets，并禁用会干扰终端绘制的 HMR。它不挂载 Host、ApiProxy、HTTP、
Web Runtime、Browser 或 headless runner。

主插件的强制注入只有创建/恢复 Agent 必需的 `agentDefaultModel`、`agents` 与
`sessions`。Tools、Approval、User Questions、Permission Presets、Compaction、
Projection、Agent Presets、Commands 和 Skills 均通过 `ctx.get()` 可选发现。
`Session Query` 同样是可选服务，只为欢迎页提供当前工作区最近会话；缺失时不影响
Agent 主链路。

## 数据流

```text
Editor submit
   │
   ├─ 本地 Slash ─── TUI 操作（Help、Session、Retry、退出）
   ├─ 官方 Slash ─── ctx.commands.execute(agent, line, AbortSignal)
   ├─ /skills ────── ctx.skills.list({ cwd, scope }) → 预填 /<skill-name>
   ├─ /mcp ───────── ctx.tools.schemas(agent) → MCP 工具目录
   ├─ /model ─────── ctx.llm.listProviders/listModels → ModelSelectionRef
   ├─ Welcome ─────── ctx.sessionQuery.filterSessions/readTitleSnapshots
   ├─ idle ───────── Agent.followup(UserMessage)
   └─ running ────── Agent.steer(UserMessage)
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

最近会话不是 Transcript 投影的一部分。启动和新建 Session 后，独立的可取消查询按
`process.cwd()` 过滤、排除当前 Session、截取 4 条并批量折叠标题，最终只把轻量展示
摘要写入 Store；查询失败不会进入 notice 或 Agent 上下文。

Transcript 投影的是 append-only Session Event Log，而不是提供给模型的 ordered
surface。Compaction 的 `surfaceOp: { op: 'replace' }` 只改变模型上下文，TUI
不会删除被遮蔽的历史；新 checkpoint 仅作为紧凑的 injected-context 记录追加。

Slash 命令发现由 `ctx.commands.list(agent)` 提供。OMP TUI 将官方目录、本地命令和
`ctx.skills.list({ cwd, scope: agent })` 返回的 `userInvocable` Skills 合并，再交给
`CombinedAutocompleteProvider`：同名时本地命令保留自己的行为，Skill 名称仅在没有冲突时
作为普通 `/<skill-name>` 补全项出现。`commands/change`、`skills/change`、`tools/change`、
新 Session 与 Agent Preset 重组都会刷新目录。`/skills` 打开选择目录，选择后仅预填 Skill
手势；已解析的官方命令通过 `ctx.commands.execute()` 执行，执行结果仅显示为 UI notice，
不进入模型上下文；未注册的 Slash 输入仍作为普通 Agent 消息发送，以保留 Skill 手势等模型
侧扩展入口。命令适配层同时兼容 rc.7 的 `(agent, line, signal)` 与 rc.8 的
`(agent, line, images, signal)` 签名；当前 TUI 尚无图片 composer，因此向 rc.8 明确传入空图片列表。

MCP 没有独立的 Harness 服务面：`@deepseek-ai/dsh-mcp-client` 发现 Server 工具后，会把它们
注册到 `ctx.tools`，名称为 `mcp__<server>__<tool>`。`/mcp` 从当前 Agent 可见的
`ctx.tools.schemas(agent)` 中筛选这些工具并显示目录；选择一个工具只会预填对它的任务描述，
不会越过 Agent 直接发起 MCP 调用。

`/model` 读取已注册 Provider 的 advisory 模型目录；某个 Provider 读取失败不会隐藏其他
Provider 的模型。模型确认后再通过 `resolveModelInfo()` 读取该精确路由公布的思考等级，最终将
Provider、Model 与 Reasoning Effort 作为一个 `ModelSelection` 更新当前 Agent 持有的
`ModelSelectionRef.current`。`Ctrl+R` 使用同一份精确模型元数据循环等级。Harness 在下一次
prompt assembly 时快照完整选择，因此不会拆分正在进行中的模型请求。选择同时成为本进程后续
新 Session 的默认值，并在可用时通过 `agentDefaultModel.saveSelection()` 持久化。

`/sandbox` 将三种封闭模式作为本地目录公开，也接受完整模式 ID 参数。写入只调用
`setSandboxMode(session, mode)`，由 Session 同步发布唯一的 `sandbox/mode` 事件；执行策略、
持久化和状态栏都消费同一事件日志，不维护第二份权限状态。

## Agent 生命周期

1. 等待 Cordis Loader 完成。
2. 读取 `agentDefaultModel.currentSelection()`。
3. 新 Session 可解析/挂载 Agent Preset；恢复 Session 调用正式
   `agents.resume()`。
4. `setup(agentCtx)` 安装 Model Selection，并为新 Session 挂载 Preset。
5. 等待 `agent.whenIdle()`，绑定历史与实时事件，挂载 `TuiAltScreen`。
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

`ProcessTerminal + TuiAltScreen` 使用备用屏缓冲区和差量绘制，并由应用接管滚动。
`TerminalRestore` 幂等关闭 synchronized output、bracketed paste 和 keyboard
protocol，恢复 raw mode 与光标；`ProcessSafety` 覆盖 SIGINT/SIGTERM/SIGHUP、未捕获
异常、Promise rejection 和流断开，且正常路径不直接调用 `process.exit()`。

主题使用语义色角色而不是组件内硬编码 ANSI：True Color 不可用时依次降级到 ANSI
256 与 ANSI 16。欢迎页渐变是纯渲染函数，不创建动画或计时器；StatusLine 作为输入框
上边框内容按宽度逐级省略。Agent Preset 从 Session Header 初始化，并由后续选择事件覆盖；
`plan/mode` 的 `active` 布尔值投影为 Plan/Normal；未显式选择推理强度时使用模型适配器公布的具体默认值。文件权限
优先来自当前 Session 的 `sandboxPolicy.resolve()` 有效模式，并以 `sandbox/mode` 投影降级；状态栏
将三种模式显示为 Read Only、Write 与 Full Access。状态栏采用 OMP 的 Nerd Font 图标（模式、模型、
推理强度、权限、目录、Git、上下文与压缩能力）；终端应配置兼容字体以获得完整图形。
