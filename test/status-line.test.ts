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
  type TokenMeterPort,
} from '../src/runtime/status-line-runtime.js'
import { StatusLine } from '../src/tui/components/status-line.js'
import { TuiStore } from '../src/tui/store.js'

const MAX_EFFORT = 'max' as NonNullable<ModelSelection['reasoningEffort']>

function resolvedModel(name: string, contextWindow = 1_000_000): LlmResolvedModelInfo {
  return {
    provider: 'openai',
    id: 'gpt-5.6-luna',
    name,
    context: { contextWindow },
    reasoning: { efforts: [{ id: MAX_EFFORT, name: 'max' }] },
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
    store.setSession('session-x', 'openai', 'gpt-5.6-luna')
    store.setStatusLine({
      cwd: `${homedir()}/workspace/dsh-omp-tui`,
      modelName: 'GPT-5.6-Luna',
      reasoningEffort: 'max',
      gitBranch: 'main',
      contextTokens: 15_000,
      contextWindow: 1_000_000,
      compactionAvailable: true,
    })

    expect(plainStatus(store)).toBe(
      ' GPT-5.6-Luna ·  max   ~/workspace/dsh-omp-tui   main   1.5%/1M 󰁨',
    )
    expect(plainStatus(store)).not.toContain('openai')
    expect(plainStatus(store)).not.toContain('(sub)')
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
    expect(plain).toBe(' deepseek-chat   /repo   1.2K/?')
    expect(plain).not.toContain('  ')
  })

  it('窄宽度逐级退化且从不超出传入宽度', () => {
    const store = new TuiStore()
    store.setStatusLine({
      cwd: `${homedir()}/workspace/very-long-project-name`,
      modelName: 'GPT-5.6-Luna',
      reasoningEffort: 'max',
      gitBranch: 'feature/very-long-branch-name',
      contextTokens: 15_000,
      contextWindow: 1_000_000,
      compactionAvailable: true,
    })

    for (const width of [4, 12, 24, 48]) {
      const line = new StatusLine(store.getSnapshot()).render(width)[0] ?? ''
      expect(visibleWidth(line)).toBeLessThanOrEqual(width)
    }
  })
})

describe('StatusLineRuntime', () => {
  it('同步模型元数据、token meter 与 Git 分支到状态栏快照', async () => {
    const store = new TuiStore()
    const llm: ModelInfoPort = { resolveModelInfo: vi.fn(async () => resolvedModel('GPT-5.6-Luna')) }
    const tokenMeter: TokenMeterPort = { measure: vi.fn(() => ({ totalTokens: 15_000 })) }
    const git: GitBranchPort = { resolve: vi.fn(async () => 'main') }
    const runtime = new StatusLineRuntime(store, {
      cwd: '/repo',
      compactionAvailable: true,
      llm,
      tokenMeter,
      git,
      gitRefreshIntervalMs: 60_000,
    })
    const session = Session.create(SessionId('session-status-line'))

    runtime.setSession(session, { provider: 'openai', model: 'gpt-5.6-luna', reasoningEffort: MAX_EFFORT })

    await vi.waitFor(() => expect(store.getSnapshot().statusLine).toEqual({
      cwd: '/repo',
      modelName: 'GPT-5.6-Luna',
      reasoningEffort: 'max',
      gitBranch: 'main',
      contextTokens: 15_000,
      contextWindow: 1_000_000,
      compactionAvailable: true,
    }))
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
