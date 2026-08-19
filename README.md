# dsh-omp-tui

`dsh-omp-tui` 是 DeepSeek Harness 的原生终端 Mode Bundle。它保留完整的
`@deepseek-ai/dsh-base` Agent Runtime，只用 Node.js 兼容的
`@earendil-works/pi-tui` 替换 Web UI。

## 架构

```text
dsh launcher
└─ Cordis（同一进程）
   ├─ @deepseek-ai/dsh-base
   │  ├─ Agent / Session / LLM / Tools
   │  ├─ Approval / User Questions / Sandbox
   │  └─ Skills / AGENTS.md / Compaction
   └─ dsh-omp-tui
      ├─ AgentController ── followup / steer / cancel
      ├─ Session Event Log ── replay + live projection
      └─ TuiMainScreen ── Transcript / Status / Editor / Overlay
```

TUI 与 Harness 服务位于同一个 Cordis 插件进程中。Transcript 的唯一事实源是
`agent.session.events` 和实时 `session/event`；Store 只做可重建投影。项目不启动
Web Server，也不包含 Web/Browser、JSON-RPC、ACP、独立 Agent Runtime 或额外
`dsh` 子进程。

与官方模式的关系：

- `web`：浏览器 UI 与 HTTP/API 服务；本 Bundle 不使用。
- `headless`：适合管道和无人值守任务；stdin/stdout 非 TTY 时请使用它。
- `omp-tui`：直接驱动当前 Harness Agent 的交互式终端入口。

## 系统要求

- Node.js `^22.19.0` 或 `>=24.0.0`
- DeepSeek Harness `0.1.0-rc.7`
- 真实交互式 stdin/stdout TTY
- 可用模型调用需要配置相应 Provider/API Key

当前验证矩阵见 [docs/compatibility.md](docs/compatibility.md)。

## 安装

```bash
npm install -g @deepseek-ai/dsh
dsh plugin --profile omp-tui add https://github.com/yiran-ye/dsh-omp-tui/releases/latest/download/dsh-omp-tui.tgz
dsh --profile omp-tui
```

Bundle 的 `dsh.bundle.patch` 会自动叠加到 `dsh-base`。不要再在 Profile 的
`cordis.patch.yml` 中重复插入 `omp-tui-startup` 或 `omp-tui`。

开发安装只使用专用 Profile：

```bash
pnpm install
pnpm run build
dsh plugin --profile omp-tui-dev add "$(pwd)"
dsh --profile omp-tui-dev --dump-config
dsh --profile omp-tui-dev
```

## 运行

新 Session：

```bash
dsh --profile omp-tui
```

恢复持久化 Session（带不带 `session-` 前缀均可）：

```bash
dsh --profile omp-tui --resume <session-id>
```

为新 Session 选择 Agent Preset：

```bash
dsh --profile omp-tui --agent-preset code
```

恢复时以 Session 已持久化的运行事实为准，不用该参数覆盖历史 Preset。

### 快捷键

| 按键 | 行为 |
| --- | --- |
| Enter | 提交 |
| Shift+Enter / Alt+Enter | 换行 |
| Ctrl+C | 运行时取消；空闲空输入连续两次退出 |
| Ctrl+D | 空闲空输入连续两次退出 |
| Ctrl+O | 打开/关闭 Tool Detail Overlay |
| Esc | 关闭 Overlay；交互请求按取消/跳过收敛 |
| ↑ / ↓ | 输入历史；Overlay 中移动选择 |

### Slash Commands

| 命令 | 行为 |
| --- | --- |
| `/help` / `/hotkeys` | 打开帮助与快捷键 |
| `/tools` | 浏览当前 Session 的完整工具参数与结果 |
| `/skills` | 浏览可由用户调用的 Skill；选择后预填 `/<skill-name>` |
| `/mcp` | 浏览当前已连接 MCP Server 发现的工具；选择后预填工具名 |
| `/clear` / `/new` | flush/dispose 当前 Agent，创建新 Session，并保留输入历史 |
| `/retry` | 重新发送上一条用户任务 |
| `/exit` / `/quit` | flush Session 后优雅退出 |

除上述本地命令外，TUI 会在启动、创建新 Session、切换 Preset 或 Harness 命令表变更时，
动态发现并执行 `ctx.commands` 中注册的官方命令。当前 `dsh-base` 通常提供
`/compact`、`/feedback`、`/goal`、`/plan`；额外插件和 Agent Preset 注册的命令也会
自动出现在 `/` 补全与 `/help` 中。补全菜单可用 `↑`/`↓` 滚动，按 Enter 执行；执行中的
官方命令可用 Esc 或 Ctrl+C 取消。

`/skills` 采用与 pi-tui 相同的语义：通过当前 Agent Preset 的 `skills` 服务（没有
Preset 时回退至 `ctx.skills`）异步列出 `userInvocable` Skills。每个 Skill 也会加入 `/`
补全；选择 `/skills` 目录中的条目只会预填 `/<skill-name>`，仍需按 Enter 后才由 DSH 的
Skill 手势注入执行。

`/mcp` 不会直接调用 MCP 工具。它从当前 Agent 可见的 `ctx.tools.schemas()` 中筛选
`mcp__<server>__<tool>` 名称，并显示由 `@deepseek-ai/dsh-mcp-client` 发现的工具；模型会在
后续任务中自行调用它们。MCP Client 未安装、未连接或没有发现工具时，`/mcp` 会明确提示。

### 本地 Context7 MCP

DSH 不会自动扫描项目内的 MCP 配置。本仓库将 `.dsh/` 作为本地私有覆盖目录并忽略它；如需
为当前项目启用 Context7，请自行创建 `.dsh/context7.patch.yml`。它只在此次启动中生效，
不会修改 Profile 的 `cordis.patch.yml`：

```yaml
- insert:
    - id: mcp-context7
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: context7
        transport: streamable-http
        url: https://mcp.context7.com/mcp
        headers: !!js >-
          process.env.CONTEXT7_API_KEY
            ? { Authorization: `Bearer ${process.env.CONTEXT7_API_KEY}` }
            : {}
        failOnStartupError: true
```

```sh
# 每个要使用它的 Profile 只需安装一次 Client；这本身不会启用 Context7。
dsh plugin --profile omp-tui add @deepseek-ai/dsh-mcp-client@0.1.0-rc.7

# 必须在本仓库根目录运行；启动时才叠加项目配置。
dsh --profile omp-tui --patch .dsh/context7.patch.yml
```

Context7 可匿名发现工具；如需使用 API Key，在项目根目录新建未提交的 `.env`，并设置
`CONTEXT7_API_KEY=...`。DSH 会在启动时读取当前项目的 `.env`；可复制 `.env.example` 作为起点。

## 配置覆盖

Bundle 自带 `cordis.patch.yml`，禁用 HMR、插入 startup/TUI，并补充
session-stats 与 Agent Preset roster。仍可通过 DSH 正常的用户 Profile patch
覆盖已有服务配置，例如默认 Provider/Model、permission preset 或 sandbox；不要
复制本 Bundle 的 Entry。TUI 插件自身支持：

```yaml
- id: omp-tui
  config:
    maxToolLines: 12
```

## 交互安全

Approval 与 User Questions 共用一个 FIFO Overlay。rc.7 的 Approval 正式结果为
`allowed-once`、`rejected`、`cancelled`、`unavailable`，因此 UI 不虚构“本会话
总是允许”。Question 支持单选、多选、自由文本和跳过。

终端保持主屏缓冲区以保留 scrollback。正常退出、信号、异常和 TTY 断开路径都会
尽最大努力停止 TUI、关闭括号粘贴/同步输出、退出 raw mode 并显示光标。

## 故障排查

- `stdin and stdout must both be TTYs`：不要将本模式接管道；改用
  `dsh --profile headless`。
- 模型调用失败：先检查目标 Provider 的 API Key 与默认 Model 配置。
- `--resume` 找不到 Session：确认 ID 属于当前 Harness home/profile；可省略
  `session-` 前缀，但不能用同名新建代替正式恢复。
- 没有 Approval/Question Overlay：运行 `--dump-config`，确认 base 中对应服务已
  挂载；TUI 会显示可选服务缺失提示并 fail-closed。
- 终端显示异常：先执行 `reset`；项目自身不会启用 Alternate Screen。

## 卸载

```bash
dsh plugin --profile omp-tui remove dsh-omp-tui
```

开发 Profile：

```bash
dsh plugin --profile omp-tui-dev remove dsh-omp-tui
```

## 开发

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

更多内容见 [docs/architecture.md](docs/architecture.md)、
[docs/development.md](docs/development.md) 与 [ROADMAP.md](ROADMAP.md)。

## 许可

MIT。参考来源与改写范围见 [NOTICE](NOTICE)。
