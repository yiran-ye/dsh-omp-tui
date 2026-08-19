import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { AgentSessionBinding, type RuntimeAgent, type RuntimeEventSource } from '../src/runtime/agent-session.js'
import { TuiStore } from '../src/tui/store.js'
import type { SessionEventLike } from '../src/tui/state.js'

class EventSource implements RuntimeEventSource {
  sessionListeners: ((session: Session, event: SessionEventLike) => void)[] = []
  statusListeners: ((agent: RuntimeAgent, status: AgentStatus) => void)[] = []
  inboxListeners: ((agent: RuntimeAgent) => void)[] = []

  onSessionEvent(listener: (session: Session, event: SessionEventLike) => void): () => void {
    this.sessionListeners.push(listener)
    return () => {
      this.sessionListeners = this.sessionListeners.filter((candidate) => candidate !== listener)
    }
  }

  onAgentStatus(listener: (agent: RuntimeAgent, status: AgentStatus) => void): () => void {
    this.statusListeners.push(listener)
    return () => {
      this.statusListeners = this.statusListeners.filter((candidate) => candidate !== listener)
    }
  }

  onAgentInbox(listener: (agent: RuntimeAgent) => void): () => void {
    this.inboxListeners.push(listener)
    return () => {
      this.inboxListeners = this.inboxListeners.filter((candidate) => candidate !== listener)
    }
  }
}

describe('TuiStore 与 AgentSessionBinding', () => {
  it('只在 snapshot 变化时通知订阅者', () => {
    const store = new TuiStore()
    let notifications = 0
    const unsubscribe = store.subscribe(() => notifications++)
    store.setStatus('running')
    store.appendEvent({ type: 'unknown', seq: 0, time: 0, data: {} })
    store.appendEvent({ type: 'unknown', seq: 0, time: 0, data: {} })
    unsubscribe()
    store.setStatus('idle')
    expect(notifications).toBe(2)
  })

  it('绑定 Session、Agent status 和 inbox，并可解除监听', () => {
    const source = new EventSource()
    const session = Session.create(SessionId('session-store-test'))
    const agent: RuntimeAgent = {
      session,
      status: 'idle',
      inbox: { nextStep: [], nextTurn: [] },
    }
    const store = new TuiStore()
    const binding = new AgentSessionBinding(agent, store, source)
    source.statusListeners[0]?.(agent, 'running')
    source.sessionListeners[0]?.(session, {
      type: 'user/message',
      seq: 0,
      time: 0,
      data: { content: [{ type: 'text', text: 'live' }], source: { kind: 'user' } },
    })
    expect(store.getSnapshot().status).toBe('running')
    expect(store.getSnapshot().transcript).toHaveLength(1)
    binding.disconnect()
    expect(source.sessionListeners).toHaveLength(0)
    expect(source.statusListeners).toHaveLength(0)
    expect(source.inboxListeners).toHaveLength(0)
  })
})
