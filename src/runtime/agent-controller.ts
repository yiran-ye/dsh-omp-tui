import type { Context } from '@deepseek-ai/cordis'
import {
  installModelSelection,
  type AgentStatus,
  type CreateAgentOptions,
  type ModelSelection,
  type ModelSelectionRef,
  type ResumeAgentOptions,
} from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionStore } from '@deepseek-ai/dsh-session'
import { createSessionId, normalizeSessionId } from '../session-id.js'
import { TuiStore } from '../tui/store.js'
import { AgentSessionBinding, type RuntimeAgent, type RuntimeEventSource } from './agent-session.js'
import type { StatusLineRuntimePort } from './status-line-runtime.js'

export interface ControlledAgent extends RuntimeAgent {
  readonly id: string
  readonly options: { readonly provider?: string; readonly model?: string }
  followup(message: UserMessage): void
  steer(message: UserMessage): void
  cancel(cause: { readonly kind: 'user' | 'disposed' }): void
  whenIdle(): Promise<void>
}

export interface ControlledAgentHandle {
  readonly agent: ControlledAgent
  dispose(): Promise<void>
}

export interface AgentRegistryPort {
  create(options: CreateAgentOptions): Promise<ControlledAgentHandle>
  resume(options: ResumeAgentOptions): Promise<ControlledAgentHandle>
}

export interface SessionStorePort {
  flush(session: Session): Promise<boolean>
}

export interface DefaultModelPort {
  currentSelection(): ModelSelection
  saveSelection?(selection: ModelSelection): Promise<void>
}

export interface AgentPresetPort {
  resolve(id?: string): Promise<{ readonly id: string }>
  mount(agentCtx: Context, id?: string): Promise<unknown>
}

export interface AgentControllerOptions {
  readonly agents: AgentRegistryPort
  readonly sessions: SessionStorePort | Pick<SessionStore, 'flush'>
  readonly defaultModel: DefaultModelPort
  readonly presets?: AgentPresetPort
  readonly eventSource: RuntimeEventSource
  readonly cwd: string
  readonly store?: TuiStore
  readonly statusLine?: StatusLineRuntimePort
  readonly ready?: () => Promise<void>
  readonly stopUi?: () => void | Promise<void>
  readonly requestExit?: (code: number) => void
}

export interface StartAgentOptions {
  readonly resume?: string
  readonly agentPreset?: string
}

export class AgentController {
  readonly store: TuiStore
  private handle: ControlledAgentHandle | undefined
  private binding: AgentSessionBinding | undefined
  private modelSelection: ModelSelectionRef | undefined
  private selectedModelOverride: ModelSelection | undefined
  private startup: StartAgentOptions = {}
  private lifecycleTail: Promise<void> = Promise.resolve()
  private closing = false
  private shutdownPromise: Promise<void> | undefined

  constructor(private readonly options: AgentControllerOptions) {
    this.store = options.store ?? new TuiStore()
    this.store.setCapabilities({ agentPresets: options.presets !== undefined })
  }

  get agent(): ControlledAgent | undefined {
    return this.handle?.agent
  }

  start(startup: StartAgentOptions = {}): Promise<ControlledAgent> {
    return this.serializeLifecycle(async () => {
      this.assertOpen()
      if (this.handle !== undefined) throw new Error('Agent Controller 已启动。')
      this.startup = startup
      await this.options.ready?.()
      this.assertOpen()
      return this.attach(startup.resume)
    })
  }

  send(text: string): void {
    if (text.trim().length === 0) return
    const agent = this.requireAgent()
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    })
    if (agent.status === 'running') agent.steer(message)
    else agent.followup(message)
  }

  cancel(): void {
    const agent = this.handle?.agent
    if (agent?.status === 'running') agent.cancel({ kind: 'user' })
  }

  selectModel(selection: ModelSelection): Promise<void> {
    return this.serializeLifecycle(async () => {
      this.assertOpen()
      if (selection.provider.length === 0 || selection.model.length === 0) {
        throw new Error('Provider 和模型不能为空。')
      }
      if (selection.reasoningEffort?.length === 0) {
        throw new Error('思考等级不能为空。')
      }
      const handle = this.handle
      const selectionRef = this.modelSelection
      if (handle === undefined || selectionRef === undefined) {
        throw new Error('Agent Controller 尚未启动。')
      }
      const next: ModelSelection = {
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
      }
      selectionRef.current = next
      this.selectedModelOverride = next
      this.store.setSession(handle.agent.id, next.provider, next.model, next.reasoningEffort)
      this.options.statusLine?.setSelection(next)
      try {
        await this.options.defaultModel.saveSelection?.(next)
      } catch (error) {
        const effort = next.reasoningEffort === undefined ? '' : `（${next.reasoningEffort}）`
        this.store.setNotice(
          `已切换模型为 ${next.provider}/${next.model}${effort}；无法保存为默认模型：${error instanceof Error ? error.message : String(error)}`,
        )
      }
    })
  }

  newSession(): Promise<ControlledAgent> {
    if (this.closing) return Promise.reject(new Error('Agent Controller 正在关闭。'))
    return this.serializeLifecycle(async () => {
      this.assertOpen()
      await this.releaseCurrent(false)
      this.assertOpen()
      return this.attach(undefined)
    })
  }

  shutdown(code = 0): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise
    this.closing = true
    this.store.beginClosing()
    this.shutdownPromise = this.serializeLifecycle(() => this.performShutdown(code))
    return this.shutdownPromise
  }

  private serializeLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycleTail.then(operation)
    this.lifecycleTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private assertOpen(): void {
    if (this.closing) throw new Error('Agent Controller 正在关闭。')
  }

  private async attach(resume: string | undefined): Promise<ControlledAgent> {
    const sourceSelection = this.selectedModelOverride ?? this.options.defaultModel.currentSelection()
    const selection: ModelSelection = {
      provider: sourceSelection.provider,
      model: sourceSelection.model,
      ...(sourceSelection.reasoningEffort === undefined ? {} : { reasoningEffort: sourceSelection.reasoningEffort }),
    }
    let resolvedPreset: { readonly id: string } | undefined
    if (resume === undefined && this.options.presets !== undefined) {
      try {
        resolvedPreset = await this.options.presets.resolve(this.startup.agentPreset)
      } catch (error) {
        this.store.setNotice(`Agent Preset 无法解析：${error instanceof Error ? error.message : String(error)}`)
      }
    } else if (resume === undefined && this.startup.agentPreset !== undefined) {
      this.store.setNotice('当前 Profile 未挂载 Agent Preset 服务，已忽略 --agent-preset。')
    }

    const selectionRef: ModelSelectionRef = { current: selection, assembled: undefined }
    const setup = async (agentCtx: Context): Promise<void> => {
      installModelSelection(agentCtx, selectionRef)
      if (resolvedPreset !== undefined) await this.options.presets?.mount(agentCtx, resolvedPreset.id)
    }
    const agentOptions = { provider: selection.provider, model: selection.model }
    const handle = resume === undefined
      ? await this.options.agents.create({
          sessionId: createSessionId(),
          meta: {
            cwd: this.options.cwd,
            ...(resolvedPreset === undefined ? {} : { agentPreset: resolvedPreset.id }),
          },
          agentOptions,
          setup,
        })
      : await this.options.agents.resume({
          resumeSessionId: normalizeSessionId(resume),
          agentOptions,
          setup,
        })

    this.handle = handle
    this.modelSelection = selectionRef
    await handle.agent.whenIdle()
    this.binding = new AgentSessionBinding(
      handle.agent,
      this.store,
      this.options.eventSource,
      () => this.options.statusLine?.syncContext(),
    )
    this.store.setSession(handle.agent.id, selection.provider, selection.model, selection.reasoningEffort)
    this.options.statusLine?.setSession(handle.agent.session, selection)
    return handle.agent
  }

  private async releaseCurrent(stopUi: boolean): Promise<void> {
    const handle = this.handle
    const binding = this.binding
    this.handle = undefined
    this.binding = undefined
    this.modelSelection = undefined
    if (handle === undefined) {
      binding?.disconnect()
      if (stopUi) await this.options.stopUi?.()
      return
    }
    this.options.statusLine?.detachSession(handle.agent.session)
    const errors: unknown[] = []
    if (handle.agent.status === 'running') handle.agent.cancel({ kind: 'user' })
    try {
      await handle.agent.whenIdle()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.options.sessions.flush(handle.agent.session)
    } catch (error) {
      errors.push(error)
    }
    binding?.disconnect()
    if (stopUi) {
      try {
        await this.options.stopUi?.()
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      await handle.dispose()
    } catch (error) {
      errors.push(error)
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Agent 生命周期清理失败。')
  }

  private async performShutdown(code: number): Promise<void> {
    let error: unknown
    try {
      await this.releaseCurrent(true)
    } catch (cause) {
      error = cause
    } finally {
      this.options.statusLine?.dispose()
      this.options.requestExit?.(error === undefined ? code : 1)
    }
    if (error instanceof Error) throw error
    if (error !== undefined) throw new Error('Agent 生命周期清理失败。', { cause: error })
  }

  private requireAgent(): ControlledAgent {
    if (this.handle === undefined) throw new Error('Agent Controller 尚未启动。')
    return this.handle.agent
  }
}

export function agentStatus(agent: ControlledAgent | undefined): AgentStatus {
  return agent?.status ?? 'idle'
}
