import type { Context } from '@deepseek-ai/cordis'
import type { AgentStatus, CreateAgentOptions, ModelSelection, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import {
  AgentController,
  type AgentPresetPort,
  type AgentRegistryPort,
  type ControlledAgent,
  type ControlledAgentHandle,
} from '../src/runtime/agent-controller.js'
import type { RuntimeAgent, RuntimeEventSource } from '../src/runtime/agent-session.js'
import type { StatusLineRuntimePort } from '../src/runtime/status-line-runtime.js'
import type { SessionEventLike } from '../src/tui/state.js'

const HIGH_EFFORT = 'high' as NonNullable<ModelSelection['reasoningEffort']>

class NoopEvents implements RuntimeEventSource {
  onSessionEvent(_listener: (session: Session, event: SessionEventLike) => void): () => void {
    return () => undefined
  }

  onAgentStatus(_listener: (agent: RuntimeAgent, status: AgentStatus) => void): () => void {
    return () => undefined
  }

  onAgentInbox(_listener: (agent: RuntimeAgent) => void): () => void {
    return () => undefined
  }
}

function deferredVoid(): { readonly promise: Promise<void>; resolve(): void } {
  let settle: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    settle = resolve
  })
  return {
    promise,
    resolve() {
      if (settle === undefined) throw new Error('deferred promise is not initialized')
      settle()
    },
  }
}

class FakeAgent implements ControlledAgent {
  readonly id: string
  readonly options = { provider: 'deepseek', model: 'deepseek-chat' }
  readonly inbox = { nextStep: [] as UserMessage[], nextTurn: [] as UserMessage[] }
  status: AgentStatus = 'idle'
  followups: UserMessage[] = []
  steering: UserMessage[] = []
  cancelCount = 0
  idleCount = 0
  whenIdleHook: (() => Promise<void>) | undefined

  constructor(readonly session: Session) {
    this.id = session.id
  }

  followup(message: UserMessage): void {
    this.followups.push(message)
  }

  steer(message: UserMessage): void {
    this.steering.push(message)
  }

  cancel(_cause: { readonly kind: 'user' | 'disposed' }): void {
    this.cancelCount++
    this.status = 'idle'
  }

  async whenIdle(): Promise<void> {
    this.idleCount++
    await this.whenIdleHook?.()
  }
}

function harness(statusLine?: StatusLineRuntimePort) {
  const created: CreateAgentOptions[] = []
  const resumed: ResumeAgentOptions[] = []
  const agents: FakeAgent[] = []
  const disposed = vi.fn(async (_agentId: string) => undefined)
  let serial = 0
  const makeHandle = (): ControlledAgentHandle => {
    serial++
    const session = Session.create(SessionId(`session-fake-${serial}`))
    const agent = new FakeAgent(session)
    agents.push(agent)
    return { agent, dispose: async () => disposed(agent.id) }
  }
  const registry: AgentRegistryPort = {
    async create(options) {
      created.push(options)
      return makeHandle()
    },
    async resume(options) {
      resumed.push(options)
      return makeHandle()
    },
  }
  const flush = vi.fn(async () => true)
  const stopUi = vi.fn(async () => undefined)
  const requestExit = vi.fn()
  const selection: ModelSelection = { provider: 'deepseek', model: 'deepseek-chat' }
  const saveSelection = vi.fn(async (_next: ModelSelection) => undefined)
  const controller = new AgentController({
    agents: registry,
    sessions: { flush },
    defaultModel: { currentSelection: () => selection, saveSelection },
    eventSource: new NoopEvents(),
    cwd: '/workspace',
    ...(statusLine === undefined ? {} : { statusLine }),
    stopUi,
    requestExit,
  })
  return { controller, agents, created, resumed, disposed, flush, stopUi, requestExit, saveSelection }
}

describe('AgentController', () => {
  it('新建 Session 并根据状态选择 followup/steer', async () => {
    const { controller, created } = harness()
    const agent = await controller.start()
    if (!(agent instanceof FakeAgent)) throw new Error('expected FakeAgent')
    expect(created).toHaveLength(1)
    expect(created[0]?.meta?.cwd).toBe('/workspace')
    controller.send('第一条')
    expect(agent.followups).toHaveLength(1)
    agent.status = 'running'
    controller.send('运行中追加')
    expect(agent.steering).toHaveLength(1)
  })

  it('恢复时调用正式 agents.resume 并规范化 ID', async () => {
    const { controller, created, resumed } = harness()
    await controller.start({ resume: 'abc' })
    expect(created).toHaveLength(0)
    expect(resumed[0]?.resumeSessionId).toBe('session-abc')
  })

  it('running 时 cancel，idle 时不取消', async () => {
    const { controller } = harness()
    const agent = await controller.start()
    if (!(agent instanceof FakeAgent)) throw new Error('expected FakeAgent')
    controller.cancel()
    expect(agent.cancelCount).toBe(0)
    agent.status = 'running'
    controller.cancel()
    expect(agent.cancelCount).toBe(1)
  })

  it('切换模型会更新当前选择，并供后续新 Session 沿用', async () => {
    const { controller, created, saveSelection } = harness()
    await controller.start()

    await controller.selectModel({ provider: 'openai', model: 'gpt-5.4', reasoningEffort: HIGH_EFFORT })

    expect(controller.store.getSnapshot()).toMatchObject({
      provider: 'openai',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    })
    expect(saveSelection).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    })
    expect(controller.store.getSnapshot().notice).toBeUndefined()

    await controller.newSession()
    expect(created[1]?.agentOptions).toEqual({ provider: 'openai', model: 'gpt-5.4' })
  })

  it('将会话、模型选择和关闭生命周期同步给 StatusLine', async () => {
    const setSession = vi.fn()
    const detachSession = vi.fn()
    const setSelection = vi.fn()
    const syncContext = vi.fn()
    const dispose = vi.fn()
    const statusLine: StatusLineRuntimePort = {
      setSession,
      detachSession,
      setSelection,
      syncContext,
      dispose,
    }
    const { controller } = harness(statusLine)

    const agent = await controller.start()
    expect(setSession).toHaveBeenCalledWith(agent.session, {
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    expect(syncContext).toHaveBeenCalledOnce()

    await controller.selectModel({ provider: 'openai', model: 'gpt-5.6-luna', reasoningEffort: HIGH_EFFORT })
    expect(setSelection).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'high',
    })

    await controller.shutdown()
    expect(detachSession).toHaveBeenCalledWith(agent.session)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('shutdown 只执行一次，并按 flush、停止 UI、dispose、appExit 收敛', async () => {
    const { controller, disposed, flush, stopUi, requestExit } = harness()
    await controller.start()
    await Promise.all([controller.shutdown(), controller.shutdown()])
    expect(flush).toHaveBeenCalledTimes(1)
    expect(stopUi).toHaveBeenCalledTimes(1)
    expect(disposed).toHaveBeenCalledTimes(1)
    expect(requestExit).toHaveBeenCalledOnce()
    expect(requestExit).toHaveBeenCalledWith(0)
    expect(controller.store.getSnapshot().lifecycle).toBe('closing')
  })

  it('/clear 生命周期会 flush/dispose 旧 Agent 并创建新 Session', async () => {
    const { controller, created, disposed, flush } = harness()
    const first = await controller.start()
    const second = await controller.newSession()
    expect(created).toHaveLength(2)
    expect(second).not.toBe(first)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(disposed).toHaveBeenCalledTimes(1)
  })

  it('连续 /clear 串行执行，所有被替换 Agent 都会被释放', async () => {
    const { controller, created, disposed } = harness()
    const first = await controller.start()
    if (!(first instanceof FakeAgent)) throw new Error('expected FakeAgent')
    const releaseGate = deferredVoid()
    first.whenIdleHook = () => releaseGate.promise

    const firstClear = controller.newSession()
    await vi.waitFor(() => expect(first.idleCount).toBe(2))
    const secondClear = controller.newSession()
    await Promise.resolve()
    await Promise.resolve()
    expect(created).toHaveLength(1)

    releaseGate.resolve()
    const [intermediate, current] = await Promise.all([firstClear, secondClear])
    expect(controller.agent).toBe(current)
    expect(created).toHaveLength(3)
    expect(disposed).toHaveBeenNthCalledWith(1, first.id)
    expect(disposed).toHaveBeenNthCalledWith(2, intermediate.id)
  })

  it('/clear 清理期间 shutdown 会阻止新 Agent attach 并完整退出', async () => {
    const { controller, created, disposed, stopUi, requestExit } = harness()
    const first = await controller.start()
    if (!(first instanceof FakeAgent)) throw new Error('expected FakeAgent')
    const releaseGate = deferredVoid()
    first.whenIdleHook = () => releaseGate.promise

    const clear = controller.newSession()
    await vi.waitFor(() => expect(first.idleCount).toBe(2))
    const clearRejected = expect(clear).rejects.toThrow('正在关闭')
    const shutdown = controller.shutdown()
    releaseGate.resolve()

    await clearRejected
    await shutdown
    expect(created).toHaveLength(1)
    expect(disposed).toHaveBeenCalledOnce()
    expect(disposed).toHaveBeenCalledWith(first.id)
    expect(stopUi).toHaveBeenCalledOnce()
    expect(requestExit).toHaveBeenCalledWith(0)
    expect(controller.agent).toBeUndefined()
  })

  it('缺少可选 Preset 服务时优雅降级', async () => {
    const { controller } = harness()
    await controller.start({ agentPreset: 'code' })
    expect(controller.store.getSnapshot().notice).toContain('未挂载 Agent Preset')
    expect(controller.store.getSnapshot().capabilities.agentPresets).toBe(false)
  })

  it('有 Preset 服务时解析，并写入 create meta', async () => {
    const base = harness()
    const preset: AgentPresetPort = {
      resolve: vi.fn(async (id?: string) => ({ id: id ?? 'standard' })),
      mount: vi.fn(async (_ctx: Context) => undefined),
    }
    const controller = new AgentController({
      agents: {
        create: async (options) => {
          base.created.push(options)
          return { agent: new FakeAgent(Session.create(SessionId('session-preset'))), dispose: async () => undefined }
        },
        resume: async () => {
          throw new Error('unexpected resume')
        },
      },
      sessions: { flush: async () => true },
      defaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) },
      presets: preset,
      eventSource: new NoopEvents(),
      cwd: '/workspace',
    })
    await controller.start({ agentPreset: 'code' })
    expect(base.created[0]?.meta?.agentPreset).toBe('code')
  })
})
