# 开发指南

## 环境与安装

```bash
node --version
pnpm --version
dsh --version
pnpm install
```

本项目锁定并测试 DeepSeek Harness `0.1.0-rc.7`。升级 Harness 时先重新检查
相关 package exports、`.d.ts` 与 `docs/compatibility.md` 中列出的接口，不要
根据旧 RC 猜测 API。

## 验证

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

测试使用 fake Agent/Session，不需要 API Key。事件测试接受结构化
`SessionEventLike`，以覆盖未来未知事件；生产输入仍来自 Harness Session。

## 开发 Profile

只使用 `omp-tui-dev`，不要修改现有 `web`、`tui` 或 `headless`：

```bash
dsh plugin --profile omp-tui-dev add "$(pwd)"
dsh --profile omp-tui-dev --dump-config
dsh --profile omp-tui-dev --help
```

审计 dump 时确认：base 与 dsh-omp-tui 存在；没有 dsh-web-app、headless
runner、Host、HTTP、ApiProxy 或 browser；所有 Entry ID 唯一。

真实模型 smoke test 需要当前 Profile 已配置 Provider/API Key。没有 Key 时只做
配置、help、TTY 启动边界与单元测试，不能把未执行的模型调用记录为成功。

## 发布检查

- `lib/index.js` 与 `lib/startup.js` 存在并匹配 exports。
- `pnpm pack --dry-run` 不包含 test、临时仓库或 Bun-only 运行时。
- `pnpm list` 不包含 Ink、React、HTTP/JSON-RPC/ACP client。
- `NOTICE` 保留参考实现的 MIT 归属。
