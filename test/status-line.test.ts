import { homedir } from 'node:os'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vitest'
import {
  StatusLineRuntime,
  type GitBranchPort,
  type ModelInfoPort,
  type SandboxPolicyPort,
  type TokenMeterPort,
} from '../src/runtime/status-line-runtime.js'
import { StatusLine } from '../src/tui/components/status-line.js'
import { TuiStore } from '../src/tui/store.js'

const MAX_EFFORT = 'max' as NonNullable<ModelSelection['reasoningEffort']>
const HIGH_EFFORT = 'high' as NonNullable<ModelSelection['reasoningEffort']>

function resolvedModel(
  name: string,
  contextWindow = 1_000_000,
  defaultEffort: NonNullable<ModelSelection['reasoningEffort']> | null = HIGH_EFFORT,
): LlmResolvedModelInfo {
  return {
    provider: 'openai',
    id: 'gpt-5.6-luna',
    name,
    context: { contextWindow },
    reasoning: {
      efforts: [
        { id: HIGH_EFFORT, name: 'High' },
        { id: MAX_EFFORT, name: 'Maximum' },
      ],
      ...(defaultEffort === null ? {} : { defaultEffort }),
    },
  }
}

function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let settle: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return {
    promise,
    resolve(value) {
      if (settle === undefined) throw new Error('deferred promise is not initialized')
      settle(value)
    },
  }
}

function plainStatus(store: TuiStore, width = 200): string {
  return stripTerminalSequences(new StatusLine(store.getSnapshot()).renderContent(width))
}

describe('OMP 风格 StatusLine', () => {
  it('按 OMP 顺序显示具体模型名，且不显示 Provider', () => {
    const store = new TuiStore()
    store.appendEvent({
      type: 'agent-preset/selected',
      seq: 0,
      time: 0,
      data: { agentPreset: 'standard' },
    })
    store.appendEvent({
      type: 'plan/mode',
      seq: 1,
      time: 1,
      data: { active: true },
    })
    store.setSession('session-x', 'openai', 'gpt-5.6-luna')
    store.setStatusLine({
      cwd: `${homedir()}/workspace/dsh-omp-tui`,
      modelName: 'GPT-5.6-Luna',
      reasoningEffort: 'max',
      sandboxMode: 'danger-full-access',
      gitBranch: 'main',
      contextTokens: 15_000,
      contextWindow: 1_000_000,
      compactionAvailable: true,
    })

    expect(plainStatus(store)).toBe(
      '󰒓 Standard  Plan   Full Access   GPT-5.6-Luna ·  Max   ~/workspace/dsh-omp-tui   main   1.5%/1M 󰁨',
    )
    expect(plainStatus(store)).not.toContain('openai')
    expect(plainStatus(store)).not.toContain('(sub)')
  })

  it.each([
    ['read-only', ' Read Only'],
    ['workspace-write', ' Write'],
    ['danger-full-access', ' Full Access'],
  ] as const)('将沙箱模式 %s 显示为权限 %s', (sandboxMode, expected) => {
    const store = new TuiStore()
    store.setStatusLine({ modelName: 'Model', sandboxMode, compactionAvailable: false })

    expect(plainStatus(store)).toContain(`Normal  ${expected}   Model`)
  })

  it('状态栏可从会话沙箱事件降级读取权限', () => {
    const store = new TuiStore([{
      type: 'sandbox/mode',
      seq: 0,
      time: 0,
      data: { mode: 'workspace-write' },
    }])
    store.setStatusLine({ modelName: 'Model', compactionAvailable: false })

    expect(plainStatus(store)).toContain('Normal   Write   Model')
  })

  it.each([
    ['standard', 'Standard'],
    ['code', 'PTC'],
    ['minimal', 'Minimal'],
    ['cordis', 'Creator'],
    ['my-agent', 'my-agent'],
  ])('将 Agent Preset %s 显示为英文名称 %s', (agentPreset, expected) => {
    const store = new TuiStore([{
      type: 'agent-preset/selected',
      seq: 0,
      time: 0,
      data: { agentPreset },
    }])
    store.setStatusLine({ modelName: 'Model', compactionAvailable: false })

    expect(plainStatus(store)).toBe(`󰒓 ${expected}  Normal   Model   0/?`)
  })

  it('根据 plan/mode 事件显示 Normal 或 Plan', () => {
    const store = new TuiStore()
    store.setStatusLine({ modelName: 'Model', compactionAvailable: false })
    expect(plainStatus(store)).toContain('Normal   Model')

    store.appendEvent({ type: 'plan/mode', seq: 0, time: 0, data: { active: true } })
    expect(plainStatus(store)).toContain('Plan   Model')

    store.appendEvent({ type: 'plan/mode', seq: 1, time: 1, data: { active: false } })
    expect(plainStatus(store)).toContain('Normal   Model')
  })

  it('缺少 Git 或上下文窗口时不产生空分隔符，并保留未知窗口标记', () => {
    const store = new TuiStore()
    store.setStatusLine({
      cwd: '/repo',
      modelName: 'deepseek-chat',
      contextTokens: 1_234,
      compactionAvailable: false,
    })

    const plain = plainStatus(store)
    expect(plain).toBe('Normal   deepseek-chat   /repo   1.2K/?')
    expect(plain).not.toContain('  ')
  })

  it('窄宽度逐级退化且从不超出传入宽度', () => {
    const store = new TuiStore()
    store.appendEvent({
      type: 'agent-preset/selected',
      seq: 0,
      time: 0,
      data: { agentPreset: 'standard' },
    })
    store.setStatusLine({
      cwd: `${homedir()}/workspace/very-long-project-name`,
      modelName: 'GPT-5.6-Luna',
      reasoningEffort: 'max',
      sandboxMode: 'workspace-write',
      gitBranch: 'feature/very-long-branch-name',
      contextTokens: 15_000,
      contextWindow: 1_000_000,
      compactionAvailable: true,
    })

    for (const width of [4, 12, 24, 48]) {
      const line = new StatusLine(store.getSnapshot()).render(width)[0] ?? ''
      expect(visibleWidth(line)).toBeLessThanOrEqual(width)
    }

    const core = plainStatus(store, 40)
    expect(core).toContain(' GPT-5.6-Luna ·  Max')
    expect(core).toContain(' Write')
    expect(core).not.toContain('󰒓 Standard')
    expect(core).not.toContain('very-long-project-name')
    expect(core).not.toContain('feature/very-long-branch-name')
    expect(core).not.toContain('1.5%/1M')
  })
})

describe('StatusLineRuntime', () => {
  it('同步模型元数据、token meter 与 Git 分支到状态栏快照', async () => {
    const store = new TuiStore()
    const llm: ModelInfoPort = { resolveModelInfo: vi.fn(async () => resolvedModel('GPT-5.6-Luna')) }
    const tokenMeter: TokenMeterPort = { measure: vi.fn(() => ({ totalTokens: 15_000 })) }
    const sandboxPolicy: SandboxPolicyPort = { resolve: vi.fn(() => ({ mode: 'workspace-write' })) }
    const git: GitBranchPort = { resolve: vi.fn(async () => 'main') }
    const runtime = new StatusLineRuntime(store, {
      cwd: '/repo',
      compactionAvailable: true,
      llm,
      tokenMeter,
      sandboxPolicy,
      git,
      gitRefreshIntervalMs: 60_000,
    })
    const session = Session.create(SessionId('session-status-line'))

    runtime.setSession(session, { provider: 'openai', model: 'gpt-5.6-luna', reasoningEffort: MAX_EFFORT })

    await vi.waitFor(() => expect(store.getSnapshot().statusLine).toEqual({
      cwd: '/repo',
      modelName: 'GPT-5.6-Luna',
      reasoningEffort: 'max',
      sandboxMode: 'workspace-write',
      gitBranch: 'main',
      contextTokens: 15_000,
      contextWindow: 1_000_000,
      compactionAvailable: true,
    }))
    runtime.dispose()
  })

  it('随当前会话的有效沙箱策略更新权限', () => {
    const store = new TuiStore()
    let mode = 'read-only'
    const sandboxPolicy: SandboxPolicyPort = { resolve: vi.fn(() => ({ mode })) }
    const git: GitBranchPort = { resolve: vi.fn(async () => undefined) }
    const runtime = new StatusLineRuntime(store, {
      cwd: '/repo',
      compactionAvailable: false,
      sandboxPolicy,
      git,
      gitRefreshIntervalMs: 60_000,
    })
    const session = Session.create(SessionId('session-sandbox-mode'))

    expect(store.getSnapshot().statusLine.sandboxMode).toBe('read-only')
    runtime.setSession(session, { provider: 'openai', model: 'gpt-5.6-luna' })
    expect(store.getSnapshot().statusLine.sandboxMode).toBe('read-only')

    mode = 'danger-full-access'
    runtime.syncContext()
    expect(store.getSnapshot().statusLine.sandboxMode).toBe('danger-full-access')
    runtime.dispose()
  })

  it('未显式选择时显示适配器默认思考程度，并保持小写 ID', async () => {
    const store = new TuiStore()
    const llm: ModelInfoPort = { resolveModelInfo: vi.fn(async () => resolvedModel('GPT-5.6-Luna')) }
    const git: GitBranchPort = { resolve: vi.fn(async () => undefined) }
    const runtime = new StatusLineRuntime(store, {
      cwd: '/repo',
      compactionAvailable: false,
      llm,
      git,
      gitRefreshIntervalMs: 60_000,
    })

    runtime.setSelection({ provider: 'openai', model: 'gpt-5.6-luna' })

    await vi.waitFor(() => expect(store.getSnapshot().statusLine.reasoningEffort).toBe('high'))
    runtime.dispose()
  })

  it('显式思考程度覆盖适配器默认，缺少具体默认时不显示', async () => {
    const store = new TuiStore()
    const llm: ModelInfoPort = {
      resolveModelInfo: vi.fn(async (_provider, model) => model === 'explicit'
        ? resolvedModel('Explicit')
        : resolvedModel('Provider Default', 1_000_000, null)),
    }
    const git: GitBranchPort = { resolve: vi.fn(async () => undefined) }
    const runtime = new StatusLineRuntime(store, {
      cwd: '/repo',
      compactionAvailable: false,
      llm,
      git,
      gitRefreshIntervalMs: 60_000,
    })

    runtime.setSelection({ provider: 'openai', model: 'explicit', reasoningEffort: MAX_EFFORT })
    await vi.waitFor(() => expect(store.getSnapshot().statusLine.reasoningEffort).toBe('max'))

    runtime.setSelection({ provider: 'openai', model: 'provider-default' })
    await vi.waitFor(() => expect(store.getSnapshot().statusLine.modelName).toBe('Provider Default'))
    expect(store.getSnapshot().statusLine.reasoningEffort).toBeUndefined()
    runtime.dispose()
  })

  it('忽略过期的模型查询结果，并在 Git 查询失败时隐藏分支', async () => {
    const store = new TuiStore()
    const first = deferred<LlmResolvedModelInfo>()
    const second = deferred<LlmResolvedModelInfo>()
    const llm: ModelInfoPort = {
      resolveModelInfo: (_provider, model) => model === 'first' ? first.promise : second.promise,
    }
    const git: GitBranchPort = { resolve: vi.fn(async () => Promise.reject(new Error('git unavailable'))) }
    const runtime = new StatusLineRuntime(store, {
      cwd: '/repo',
      compactionAvailable: false,
      llm,
      git,
      gitRefreshIntervalMs: 60_000,
    })

    runtime.setSelection({ provider: 'openai', model: 'first' })
    runtime.setSelection({ provider: 'openai', model: 'second' })
    second.resolve(resolvedModel('Second'))
    await vi.waitFor(() => expect(store.getSnapshot().statusLine.modelName).toBe('Second'))
    first.resolve(resolvedModel('First'))
    await Promise.resolve()

    expect(store.getSnapshot().statusLine.modelName).toBe('Second')
    expect(store.getSnapshot().statusLine.gitBranch).toBeUndefined()
    runtime.dispose()
  })
})
