import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
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

  it('新会话重置时保留最近会话目录状态', () => {
    const store = new TuiStore()
    store.setRecentSessions({
      status: 'ready',
      items: [{ id: 'session-old', label: '旧会话', timeAgo: '1 小时前', timestamp: 1 }],
    })
    store.reset()
    expect(store.getSnapshot().recentSessions).toEqual({
      status: 'ready',
      items: [{ id: 'session-old', label: '旧会话', timeAgo: '1 小时前', timestamp: 1 }],
    })
  })

  it('新会话重置时保留 MCP 后台连接状态', () => {
    const store = new TuiStore()
    store.setMcpServers([{ name: 'context7', phase: 'connecting', toolCount: 0 }])

    store.reset()

    expect(store.getSnapshot().mcpServers).toEqual([
      { name: 'context7', phase: 'connecting', toolCount: 0 },
    ])
  })

  it('新会话重置时保留 StatusLine 运行时状态', () => {
    const store = new TuiStore()
    store.setStatusLine({
      cwd: '/repo',
      modelName: 'GPT-5.6-Luna',
      contextTokens: 15_000,
      contextWindow: 1_000_000,
      compactionAvailable: true,
    })

    store.reset()

    expect(store.getSnapshot().statusLine).toEqual({
      cwd: '/repo',
      modelName: 'GPT-5.6-Luna',
      contextTokens: 15_000,
      contextWindow: 1_000_000,
      compactionAvailable: true,
    })
  })

  it('新会话重置时保留本次 TUI 的思考可见性选择', () => {
    const store = new TuiStore()
    expect(store.getSnapshot().reasoningVisible).toBe(true)
    expect(store.toggleReasoningVisibility()).toBe(false)

    store.reset()

    expect(store.getSnapshot().reasoningVisible).toBe(false)
  })

  it('通知在四秒后自动清除，且新通知会重置计时', () => {
    vi.useFakeTimers()
    try {
      const store = new TuiStore()
      store.setNotice('第一条通知')

      vi.advanceTimersByTime(3_000)
      expect(store.getSnapshot().notice).toBe('第一条通知')

      store.setNotice('第一条通知')
      vi.advanceTimersByTime(3_000)
      expect(store.getSnapshot().notice).toBe('第一条通知')

      vi.advanceTimersByTime(1_000)
      expect(store.getSnapshot().notice).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
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

  it('只在完整行边界按显示帧投影连续的流式 chunk', () => {
    vi.useFakeTimers()
    try {
      const source = new EventSource()
      const session = Session.create(SessionId('session-stream-batch'))
      const agent: RuntimeAgent = {
        session,
        status: 'running',
        inbox: { nextStep: [], nextTurn: [] },
      }
      const store = new TuiStore()
      const onSessionChanged = vi.fn()
      const binding = new AgentSessionBinding(agent, store, source, onSessionChanged)
      onSessionChanged.mockClear()
      const listener = vi.fn()
      const unsubscribe = store.subscribe(listener)

      source.sessionListeners[0]?.(session, {
        type: 'assistant/chunk',
        seq: 0,
        time: 0,
        data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '流式' } },
      })
      source.sessionListeners[0]?.(session, {
        type: 'assistant/chunk',
        seq: 1,
        time: 1,
        data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '输出\n' } },
      })

      vi.advanceTimersByTime(49)
      expect(store.getSnapshot().transcript).toHaveLength(0)
      expect(listener).not.toHaveBeenCalled()
      expect(onSessionChanged).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(store.getSnapshot().transcript[0]).toMatchObject({ kind: 'assistant', text: '流式输出\n' })
      expect(listener).toHaveBeenCalledOnce()
      expect(onSessionChanged).not.toHaveBeenCalled()

      unsubscribe()
      binding.disconnect()
    } finally {
      vi.useRealTimers()
    }
  })

  it('平滑模式逐批提交，积压超过时限后一次追赶', () => {
    vi.useFakeTimers()
    try {
      const source = new EventSource()
      const session = Session.create(SessionId('session-stream-smooth'))
      const agent: RuntimeAgent = {
        session,
        status: 'running',
        inbox: { nextStep: [], nextTurn: [] },
      }
      const store = new TuiStore()
      const binding = new AgentSessionBinding(agent, store, source)
      const listener = vi.fn()
      store.subscribe(listener)

      for (let index = 0; index < 4; index++) {
        source.sessionListeners[0]?.(session, {
          type: 'assistant/chunk',
          seq: index,
          time: index,
          data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: `第 ${index + 1} 行\n` } },
        })
      }

      vi.advanceTimersByTime(50)
      expect(store.getSnapshot().transcript[0]).toMatchObject({ text: '第 1 行\n' })
      expect(listener).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(50)
      expect(store.getSnapshot().transcript[0]).toMatchObject({ text: '第 1 行\n第 2 行\n' })
      expect(listener).toHaveBeenCalledTimes(2)

      vi.advanceTimersByTime(50)
      expect(store.getSnapshot().transcript[0]).toMatchObject({
        text: '第 1 行\n第 2 行\n第 3 行\n第 4 行\n',
      })
      expect(listener).toHaveBeenCalledTimes(3)
      binding.disconnect()
    } finally {
      vi.useRealTimers()
    }
  })

  it('达到积压阈值时在同一追赶帧合并突发输出', () => {
    vi.useFakeTimers()
    try {
      const source = new EventSource()
      const session = Session.create(SessionId('session-stream-catch-up'))
      const agent: RuntimeAgent = {
        session,
        status: 'running',
        inbox: { nextStep: [], nextTurn: [] },
      }
      const store = new TuiStore()
      const binding = new AgentSessionBinding(agent, store, source)
      const listener = vi.fn()
      store.subscribe(listener)
      const replay = vi.spyOn(store, 'replay')

      for (let index = 0; index < 80; index++) {
        source.sessionListeners[0]?.(session, {
          type: 'assistant/chunk',
          seq: index,
          time: index,
          data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: `${index + 1}\n` } },
        })
      }

      expect(store.getSnapshot().transcript).toHaveLength(0)
      vi.advanceTimersByTime(0)
      expect(store.getSnapshot().transcript[0]).toMatchObject({
        text: Array.from({ length: 80 }, (_, index) => `${index + 1}\n`).join(''),
      })
      expect(listener).toHaveBeenCalledOnce()
      expect(replay).toHaveBeenCalledOnce()
      expect(replay.mock.calls[0]?.[0]).toHaveLength(1)
      replay.mockRestore()
      binding.disconnect()
    } finally {
      vi.useRealTimers()
    }
  })

  it('在换行前合并同一流式块的 token，避免逐 token 执行 reducer', () => {
    vi.useFakeTimers()
    try {
      const source = new EventSource()
      const session = Session.create(SessionId('session-stream-coalesce'))
      const agent: RuntimeAgent = {
        session,
        status: 'running',
        inbox: { nextStep: [], nextTurn: [] },
      }
      const store = new TuiStore()
      const binding = new AgentSessionBinding(agent, store, source)
      const replay = vi.spyOn(store, 'replay')

      for (let index = 0; index < 100; index++) {
        source.sessionListeners[0]?.(session, {
          type: 'assistant/chunk',
          seq: index,
          time: index,
          data: {
            turn: 1,
            step: 1,
            chunk: { type: 'text-delta', index: 0, text: index === 99 ? 'x\n' : 'x' },
          },
        })
      }
      vi.advanceTimersByTime(50)

      expect(replay).toHaveBeenCalledOnce()
      expect(replay.mock.calls[0]?.[0]).toHaveLength(1)
      expect(store.getSnapshot().transcript[0]).toMatchObject({ text: `${'x'.repeat(100)}\n` })
      replay.mockRestore()
      binding.disconnect()
    } finally {
      vi.useRealTimers()
    }
  })

  it('最终事件、状态变化与 disconnect 会立即刷新待处理 chunk', () => {
    const source = new EventSource()
    const session = Session.create(SessionId('session-stream-barriers'))
    const agent: RuntimeAgent = {
      session,
      status: 'running',
      inbox: { nextStep: [], nextTurn: [] },
    }
    const store = new TuiStore()
    const onSessionChanged = vi.fn()
    const binding = new AgentSessionBinding(agent, store, source, onSessionChanged)
    onSessionChanged.mockClear()

    source.sessionListeners[0]?.(session, {
      type: 'assistant/chunk',
      seq: 0,
      time: 0,
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '临时' } },
    })
    source.sessionListeners[0]?.(session, {
      type: 'assistant/message',
      seq: 1,
      time: 1,
      data: {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'text', text: '最终结果' }] },
      },
    })
    expect(store.getSnapshot().transcript[0]).toMatchObject({
      kind: 'assistant',
      text: '最终结果',
      streaming: false,
    })

    source.sessionListeners[0]?.(session, {
      type: 'assistant/chunk',
      seq: 2,
      time: 2,
      data: { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: '状态前' } },
    })
    source.statusListeners[0]?.(agent, 'idle')
    expect(store.getSnapshot().transcript[1]).toMatchObject({ kind: 'assistant', text: '状态前' })

    source.sessionListeners[0]?.(session, {
      type: 'assistant/chunk',
      seq: 3,
      time: 3,
      data: { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: '断开前' } },
    })
    binding.disconnect()
    expect(store.getSnapshot().transcript[1]).toMatchObject({ kind: 'assistant', text: '状态前断开前' })
    expect(onSessionChanged).toHaveBeenCalledTimes(3)
  })

  it('从 Session Header 初始化 Agent Preset，并由回放的选择事件覆盖', () => {
    const source = new EventSource()
    const id = SessionId('session-preset-state')
    const initial = Session.create(id)
    const session = Session.create(id, [{
      type: 'agent-preset/selected',
      seq: 0,
      time: 0,
      data: { agentPreset: 'code' },
    }], { ...initial.header, agentPreset: 'standard' })
    const agent: RuntimeAgent = {
      session,
      status: 'idle',
      inbox: { nextStep: [], nextTurn: [] },
    }
    const store = new TuiStore()
    const binding = new AgentSessionBinding(agent, store, source)

    expect(store.getSnapshot().harness.agentPreset).toBe('code')
    binding.disconnect()
  })
})
