# 兼容性调查

调查日期：2026-08-19。实现以本机已安装的 DeepSeek Harness 及其 TypeScript
声明为准，并与 2026-08-19 浅克隆的上游源码交叉核对。

## 运行环境

| 项目 | 已确认版本 |
| --- | --- |
| Node.js | 24.16.0 |
| pnpm | 11.15.1 |
| `dsh` | 0.1.0-rc.7 |
| `dsh` 路径 | `/usr/local/bin/dsh` |
| `@deepseek-ai/cordis` | 4.0.1 |
| `@earendil-works/pi-tui` | 0.84.2 |

以下实际运行接口包均为 `0.1.0-rc.7`：`dsh-agent`、`dsh-session`、
`dsh-llm`、`dsh-tools`、`dsh-user-approval`、`dsh-user-questions`、
`dsh-agent-default-model`、`dsh-agent-presets`、`dsh-cmdline`、
`dsh-commands`、`dsh-compaction`、`dsh-permission-presets`、`dsh-sandbox-policy`、
`dsh-session-projection`、`dsh-session-query`、`dsh-session-stats`、`dsh-skill` 与
`dsh-token-meter`。

rc.7 启动器只会向 ID 为 `agent-presets` 的 Cordis entry 注入发行版自带的
preset roots，因此 Bundle 使用这个 canonical ID。`dsh-base` 本身没有挂载该
entry，开发 Profile 的最终配置中此 ID 仍然唯一。

## Agent create/resume

- 新建：`ctx.agents.create({ sessionId, meta: { cwd, agentPreset? },
  agentOptions: { provider, model, maxTokens? }, setup })`。
- 恢复：`ctx.agents.resume({ resumeSessionId, agentOptions, setup })`。本项目不以
  相同 ID 新建空 Session。
- `setup(agentCtx)` 中通过 `installModelSelection(agentCtx, ref)` 安装当前模型；
  新 Session 如有 Preset，则调用 `ctx.agentPresets.mount(agentCtx, id)`。
- `AgentHandle` 暴露 `agent` 与异步 `dispose()`；`Agent` 状态是 `idle | running`。
- 用户消息用 `createUserMessage()` 创建。空闲调用 `followup()`，运行中调用
  `steer()`；取消调用 `cancel({ kind: 'user' })`；稳定点为 `whenIdle()`。

## Session 与事件

Session ID 是品牌字符串，交互式会话约定为 `session-${randomUUID()}`。Session
包含 `header`、`events`、`seq`、`append()`；退出前调用
`ctx.sessions.flush(session)`。实时事件是
`ctx.on('session/event', (session, event) => ...)`。

### 最近会话查询

欢迎页使用 `@deepseek-ai/dsh-session-query@0.1.0-rc.7` 的抽象
`ctx.sessionQuery` 服务，不直接读取 SQLite 或持久化文件：

- `filterSessions([{ kind: 'cwd', values: [process.cwd()] }], signal)` 返回按创建时间
  从新到旧排列的逻辑会话记录。
- UI 排除当前 `sessionId` 后截取前 4 条，再用 `readTitleSnapshots(ids, signal)` 批量
  读取日志折叠后的标题。
- 单条标题读取失败会回退为短 Session ID；目录级错误或服务未挂载会成为欢迎页的非致命
  降级状态。
- `/new` 与 `/clear` 在新 Agent 建立后重新查询；并发刷新通过 `AbortController` 淘汰旧请求。

rc.7 的核心持久事件为：

- `turn/start`、`turn/end`、`step/start`、`step/end`
- `user/message`
- `assistant/chunk`：`chunk` 为 `block-start`、`text-delta`、
  `reasoning-delta`、`tool-call-delta`、`block-end`、`usage` 或 `finish`
- `assistant/message`：包含最终 `AssistantMessage`
- `tool/call` 与 `tool/result`，以 `callId` 配对

权限/Preset 扩展事件为 `permission/preset`、`sandbox/mode`、
`approval/policy`、`agent-preset/selected`。每个事件带单调递增 `seq`；UI
按 `event.seq <= lastSeq` 去重。Agent 的易失事件是 `agent/status` 以及
`agent/inbox/inserted|claimed|discarded`。

## Approval 与 User Questions

- Approval 是 Cordis waterfall 事件 `approval/request`。请求包含 Agent、工具名、
  可选 callId/reason/signal。rc.7 的结果仅有 `allowed-once`、`rejected`、
  `cancelled`、`unavailable`，因此 MVP 不显示当前版本无法表达的“本会话总是允许”。
- Questions 通过 `ctx.userQuestions.registerProvider({ ask(request) })` 注册。
  每题可有 options、`multiSelect` 和自由文本；答案结构为
  `{ answers: [{ id, selected, custom? }] }`。

## Tool presentation

`ctx.tools.get(name, agent?)` 返回 `ToolDefinition`。优先调用
`presentCall(arguments)` 与 `presentResult(arguments, result)`；presentation
类型包括 call 侧 `generic | terminal | diff`，result 侧另有
`search | read | web`。无 presentation 或抛错时使用有界通用卡片。

## Skills 与 MCP

- `ctx.skills.list({ cwd, scope })` 返回按当前 Agent scope 合并后的 Skill 摘要；TUI 仅展示
  `invocation.userInvocable === true` 的项目，并监听 `skills/change` 重新读取。Agent Preset
  可通过 `agentPresets.serviceFor(agent, 'skills')` 提供 scope 专属目录。
- `@deepseek-ai/dsh-mcp-client@0.1.0-rc.7` 是可选插件，并不提供独立 `ctx.mcp` 服务。每个
  Server 的发现结果以 `mcp__<serverName>__<rawName>` 注册到 `ctx.tools`；因此 TUI 使用
  `ctx.tools.schemas(agent)` 和名称前缀识别 MCP 工具，并监听 `tools/change`。

## pi-tui

使用 Node.js 兼容的 `@earendil-works/pi-tui@0.84.2`：`ProcessTerminal` 管理
raw mode/括号粘贴，`TuiAltScreen` 在备用屏缓冲区差量绘制并提供应用内滚动；
退出时回到主屏并输出最后一帧文档。`Editor`、`Markdown`、`SelectList` 与
Overlay API 构成界面。
不使用 Bun-only 的 `@oh-my-pi/pi-tui`。

终端颜色由 `getCapabilities().trueColor` 和 `TERM` 共同选择 True Color、ANSI 256 或
ANSI 16。除 OMP 风格 StatusLine 的模型、目录、Git、上下文图标外，布局使用普通 Unicode；
状态栏需要 Nerd Font。当前仅提供深色语义主题；静态 Logo 渐变不会启动定时器或动画。

## 调研来源

- 本机 `/usr/local/lib/node_modules/@deepseek-ai/dsh` 中的 package.json、导出
  声明和 `.d.ts`。
- `/tmp/dsh-omp-tui-reference/deepseek-harness` 的架构文档与 core/user/bundle 源码。
- `/tmp/dsh-omp-tui-reference/dsh-tui` 的 Bundle、Agent 生命周期和 Store 设计。
- `/tmp/dsh-omp-tui-reference/pi` 的 TUI README、终端、Editor 与主屏实现。
- `/tmp/dsh-omp-tui-reference/oh-my-pi`（commit
  `565d53515b54df32fada2564d1fe9caf1a17b738`）仅用于视觉层级、状态线、欢迎页与
  工具卡片参考。
