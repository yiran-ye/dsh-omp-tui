import type { Context } from '@deepseek-ai/cordis'
import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { TuiStore } from '../tui/store.js'
import type { SessionEventLike } from '../tui/state.js'

export interface RuntimeAgent {
  readonly session: Session
  readonly status: AgentStatus
  readonly inbox: {
    readonly nextTurn: readonly UserMessage[]
    readonly nextStep: readonly UserMessage[]
  }
}

export interface RuntimeEventSource {
  onSessionEvent(listener: (session: Session, event: SessionEventLike) => void): () => void
  onAgentStatus(listener: (agent: RuntimeAgent, status: AgentStatus) => void): () => void
  onAgentInbox(listener: (agent: RuntimeAgent) => void): () => void
}

export function createCordisEventSource(ctx: Context): RuntimeEventSource {
  return {
    onSessionEvent(listener) {
      const unsubscribe = ctx.on('session/event', (session, event) => listener(session, event))
      return () => {
        unsubscribe()
      }
    },
    onAgentStatus(listener) {
      const unsubscribe = ctx.on('agent/status', ({ agent, status }) => listener(agent, status))
      return () => {
        unsubscribe()
      }
    },
    onAgentInbox(listener) {
      const unsubscribers = [
        ctx.on('agent/inbox/inserted', ({ agent }) => listener(agent)),
        ctx.on('agent/inbox/claimed', ({ agent }) => listener(agent)),
        ctx.on('agent/inbox/discarded', ({ agent }) => listener(agent)),
      ]
      return () => {
        for (const unsubscribe of unsubscribers) unsubscribe()
      }
    },
  }
}

export class AgentSessionBinding {
  private readonly unsubscribers: (() => void)[] = []
  private readonly pending: SessionEventLike[] = []
  private replaying = true
  private disconnected = false

  constructor(
    private readonly agent: RuntimeAgent,
    private readonly store: TuiStore,
    source: RuntimeEventSource,
  ) {
    this.unsubscribers.push(
      source.onSessionEvent((session, event) => {
        if (session !== this.agent.session) return
        if (this.replaying) this.pending.push(event)
        else this.store.appendEvent(event)
      }),
      source.onAgentStatus((agent, status) => {
        if (agent === this.agent) this.store.setStatus(status)
      }),
      source.onAgentInbox((agent) => {
        if (agent === this.agent) this.resnapshotInbox()
      }),
    )

    this.store.reset(this.agent.session.events)
    this.replaying = false
    this.pending.sort((left, right) => left.seq - right.seq)
    this.store.replay(this.pending)
    this.pending.length = 0
    this.store.setStatus(this.agent.status)
    this.resnapshotInbox()
  }

  disconnect(): void {
    if (this.disconnected) return
    this.disconnected = true
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe()
  }

  private resnapshotInbox(): void {
    this.store.setInboxCount(this.agent.inbox.nextStep.length + this.agent.inbox.nextTurn.length)
  }
}
