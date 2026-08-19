# Task State

## Current goal

创建基于 `@deepseek-ai/dsh-base`、使用原生 Harness 服务的 OMP 风格 TUI Bundle。

## Confirmed architecture

单一 Cordis 进程内由 Agent Controller 驱动 Harness Agent；Session Event Log 是
Transcript 唯一事实源；`@earendil-works/pi-tui` 的 `TuiMainScreen` 在终端主屏
缓冲区渲染。无 Web、HTTP、JSON-RPC、ACP 或子 `dsh` 进程。

## Detected versions

Node 24.16.0；pnpm 11.15.1；dsh 0.1.0-rc.7；Cordis 4.0.1；所有相关
`@deepseek-ai/dsh-*` 包为 0.1.0-rc.7；pi-tui 0.84.2。

## Completed

- 已阅读本地 AGENTS.md、RTK.md 与四个参考仓库相关 AGENTS.md。
- 已完成本机版本、类型声明、核心源码和参考实现调查。
- 已创建阶段 A 的 package、TypeScript、ESLint、Vitest、Bundle、startup、Session ID 与兼容性文档。
- 阶段 A 已验证：依赖安装与锁文件、严格 typecheck、startup/Session ID 测试、Bundle YAML 解析、lint 均通过。
- 阶段 B 已实现纯 Store/Reducer、Session 绑定、Cordis 实时事件桥、Agent Controller 与完整生命周期。
- 阶段 C 已实现 TuiMainScreen、Transcript、Markdown、Reasoning、Tool Card、状态栏、Editor、快捷键与终端安全。
- 阶段 D 已实现 Approval/Question 共享 FIFO、单选/多选/自由文本/跳过、Overlay、`/clear` 与 `/tools`。
- 阶段 E 已完成构建、打包 dry-run、`omp-tui-dev` 安装、最终配置审计及真实 TTY 启动/退出冒烟。
- 已修复并发 `/clear`、`/clear`/shutdown 竞态：生命周期操作串行化，closing 阻止清理后重新 attach，Handle/Binding 成对释放。
- 已修复 compaction surface replacement 错删 transcript：模型 surface 与人类 append-only 历史明确分离。

## Current phase

阶段 E 已完成；MVP 已达到当前无 API Key 环境下可验证的交付状态。

## Test results

- 最终 `pnpm run typecheck`：通过（真实退出码 0）。
- `pnpm exec vitest run test/startup.test.ts test/session-id.test.ts`：2 个文件、6 项测试通过。
- 最终 `pnpm run lint`：通过（真实退出码 0）。
- 阶段 B 定向测试：3 个文件、15 项测试通过。
- 阶段 B 后 `pnpm run typecheck` 与 `pnpm run lint`：通过。
- 阶段 C 定向测试：3 个文件、12 项测试通过。
- 修复后 `pnpm run test`：10 个文件、45 项测试通过（真实退出码 0），包含双 `/clear`、clear/shutdown 与 compaction 历史保留回归测试。
- 最终 `pnpm run build`：通过，入口产物为 `lib/index.js` 与 `lib/startup.js`（真实退出码 0）。
- `pnpm pack --dry-run`：通过；tarball 包含 Bundle、运行产物、README、文档、许可与 NOTICE。
- `dsh --profile omp-tui-dev --dump-config`：通过；包含 base/TUI，不含 Web/headless/Host/HTTP/ApiProxy/Browser，且无重复 entry ID。
- `dsh --profile omp-tui-dev --help`：通过；参数与示例正确。
- 真实 PTY 冒烟：成功进入 TUI；双击 Ctrl+C 优雅退出；日志确认关闭 bracketed paste/同步输出并显示光标。
- 非 TTY 冒烟：以退出码 1 返回明确的 headless Profile 提示。

## Known issues

- 当前环境没有 `DEEPSEEK_API_KEY`，因此未虚构真实模型回合、真实工具审批或持久 Session 恢复的在线成功结果；这些路径由 fake Harness 单测覆盖。
- DeepSeek Harness 仍为 `0.1.0-rc.7`，升级前应按 `docs/compatibility.md` 重新核对接口。

## Deferred scope

完整 `/model`、图形化 `/presets`、完整 `/context`、`/plugins`、本地 Shell
Mode、`@` 文件补全、图片、多 Session Tab。

## Next action

配置 Provider/API Key 后执行真实模型、工具交互和 `--resume` 端到端 smoke test；随后可按需发布包。
