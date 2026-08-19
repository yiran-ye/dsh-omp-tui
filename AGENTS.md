# Repository Guidelines

## 项目结构

这是一个基于 TypeScript 的 DeepSeek Harness 原生终端 TUI Bundle。核心代码位于 `src/`：`startup.ts`、`index.ts` 和 `config.ts` 负责 Bundle 接入；`src/runtime/` 管理 Agent、会话与事件投影；`src/tui/` 包含状态、主题、命令及组件，组件集中在 `src/tui/components/`。Vitest 单元测试位于 `test/`，通常与被测模块同名，如 `test/reducer.test.ts`。构建产物为 `lib/`，不要手动编辑。

## 构建、测试与开发

使用 Node.js `^22.19.0`（或 `>=24`）和 pnpm：

```sh
pnpm install          # 安装锁定依赖
pnpm run typecheck    # 以严格 TypeScript 配置检查类型
pnpm run lint         # 运行 ESLint
pnpm run test         # 运行全部 Vitest 测试
pnpm run build        # 编译 src/ 到 lib/
```

提交前依次运行 `typecheck`、`lint`、`test` 和 `build`。真实模型 smoke test 需要已配置的 DSH Profile 与 API Key；普通测试使用 fake Agent/Session，不依赖密钥。

## 代码风格与命名

遵循现有 TypeScript 风格：两空格缩进、单引号、无分号，并使用 ESM 的 `.js` 相对导入。文件名使用 kebab-case（如 `agent-controller.ts`）；类型、类和组件使用 PascalCase；函数、变量使用 camelCase。保持 `typescript-eslint` 的 strict 与 stylistic 规则通过，类型仅使用 `import type`。将运行时逻辑放在 `src/runtime/`，界面渲染放在 `src/tui/`，避免跨层耦合。

## 测试指南

使用 Vitest 的 `describe`/`it`/`expect`，测试文件命名为 `*.test.ts`。测试名称应描述可观察行为，可使用中文；覆盖事件回放、未知事件和失败路径等边界。修改 reducer、会话或交互队列时，应同步添加针对该行为的单元测试。

## 提交与拉取请求

历史采用 Conventional Commit 风格，例如 `feat: add model switcher`、`fix: surface agent request errors`、`perf: smooth transcript scrolling`。使用简短的祈使主题；必要时在正文说明运行时影响。PR 应说明目的与测试结果，关联相关 issue；TUI 视觉或交互变更请附终端截图或录屏。不要提交 `.env`、API Key 或本地 `.dsh/` 覆盖配置。
