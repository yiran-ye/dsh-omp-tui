import { describe, expect, it } from 'vitest'
import { TuiStore } from '../src/tui/store.js'
import type { SessionEventLike } from '../src/tui/state.js'

function event(seq: number, type: string, data: unknown, time = seq * 10): SessionEventLike {
  return { seq, type, data, time }
}

describe('Session Event reducer', () => {
  it('历史回放与实时重叠时按 seq 去重', () => {
    const store = new TuiStore([
      event(0, 'user/message', {
        content: [{ type: 'text', text: '第一次' }],
        source: { kind: 'user' },
      }),
    ])
    store.appendEvent(event(0, 'user/message', {
      content: [{ type: 'text', text: '重复' }],
      source: { kind: 'user' },
    }))
    expect(store.getSnapshot().transcript).toHaveLength(1)
    expect(store.getSnapshot().lastSeq).toBe(0)
  })

  it('投影普通用户消息，并压缩插件注入上下文', () => {
    const store = new TuiStore()
    store.appendEvent(event(0, 'user/message', {
      content: [{ type: 'text', text: '检查仓库' }],
      source: { kind: 'user' },
    }))
    store.appendEvent(event(1, 'user/message', {
      content: [{ type: 'text', text: '# AGENTS.md\n非常长的规则' }],
      source: { kind: 'plugin', plugin: 'instructions', form: 'instructions' },
    }))
    const [user, injected] = store.getSnapshot().transcript
    expect(user).toMatchObject({ kind: 'user', text: '检查仓库', injected: false })
    expect(injected).toMatchObject({ kind: 'user', injected: true })
    expect(injected?.kind === 'user' ? injected.text : '').not.toContain('非常长')
    expect(injected?.kind === 'user' ? injected.detail : '').toContain('非常长')
  })

  it('累计 reasoning 与正文 chunk，且不保存逐 token 条目', () => {
    const store = new TuiStore()
    store.appendEvent(event(0, 'assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: '正在' },
    }))
    store.appendEvent(event(1, 'assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: '思考' },
    }))
    store.appendEvent(event(2, 'assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 1, text: '答案' },
    }))
    expect(store.getSnapshot().transcript).toHaveLength(1)
    expect(store.getSnapshot().transcript[0]).toMatchObject({
      kind: 'assistant',
      reasoning: '正在思考',
      text: '答案',
      streaming: true,
    })
  })

  it('最终 assistant/message 收敛临时流式块', () => {
    const store = new TuiStore([
      event(0, 'assistant/chunk', {
        turn: 2,
        step: 3,
        chunk: { type: 'text-delta', index: 0, text: '临时' },
      }),
    ])
    store.appendEvent(event(1, 'assistant/message', {
      turn: 2,
      step: 3,
      message: {
        content: [
          { type: 'reasoning', text: '最终推理' },
          { type: 'text', text: '最终答案' },
        ],
      },
    }))
    expect(store.getSnapshot().transcript).toHaveLength(1)
    expect(store.getSnapshot().transcript[0]).toMatchObject({
      kind: 'assistant',
      reasoning: '最终推理',
      text: '最终答案',
      streaming: false,
      blocks: [],
    })
  })

  it('按 callId 配对 tool/call 与 tool/result', () => {
    const store = new TuiStore([
      event(0, 'tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{"cmd":"pwd"}' }, 100),
      event(1, 'tool/result', {
        turn: 1,
        step: 1,
        message: {
          content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: '/tmp' }] }],
        },
      }, 181),
    ])
    expect(store.getSnapshot().transcript).toHaveLength(1)
    expect(store.getSnapshot().transcript[0]).toMatchObject({
      kind: 'tool',
      callId: 'call-1',
      name: 'bash',
      result: '/tmp',
      status: 'success',
      durationMs: 81,
    })
  })

  it('compaction 的 surface replacement 保留人类 transcript 历史', () => {
    const store = new TuiStore([
      event(0, 'user/message', {
        content: [{ type: 'text', text: '原始问题' }],
        source: { kind: 'user' },
      }),
      event(1, 'assistant/message', {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'text', text: '原始回答' }] },
      }),
      event(2, 'tool/call', {
        turn: 1,
        step: 2,
        callId: 'compact-call',
        name: 'read',
        arguments: '{"path":"README.md"}',
      }),
      event(3, 'tool/result', {
        turn: 1,
        step: 2,
        message: {
          content: [{ type: 'tool-result', toolCallId: 'compact-call', content: [{ type: 'text', text: '旧结果' }] }],
        },
      }),
    ])
    store.appendEvent({
      ...event(4, 'user/message', {
        content: [{ type: 'text', text: '压缩摘要' }],
        source: { kind: 'plugin', plugin: 'compact' },
      }),
      surfaceOp: { op: 'replace', start: 0, end: 3 },
    })

    expect(store.getSnapshot().transcript).toHaveLength(4)
    expect(store.getSnapshot().transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'user', text: '原始问题' }),
      expect.objectContaining({ kind: 'assistant', text: '原始回答' }),
      expect.objectContaining({ kind: 'tool', callId: 'compact-call', result: '旧结果' }),
      expect.objectContaining({ kind: 'user', injected: true, sourceLabel: 'compact' }),
    ]))
  })

  it('未知事件不崩溃且仍推进 seq 边界', () => {
    const store = new TuiStore()
    expect(() => store.appendEvent(event(4, 'future/event', { value: true }))).not.toThrow()
    expect(store.getSnapshot()).toMatchObject({ lastSeq: 4, unknownEventCount: 1 })
  })

  it('投影权限、沙箱、审批策略与 Agent Preset', () => {
    const store = new TuiStore([
      event(0, 'permission/preset', { preset: 'workspace-write' }),
      event(1, 'sandbox/mode', { mode: 'workspace-write' }),
      event(2, 'approval/policy', { policy: 'ask' }),
      event(3, 'agent-preset/selected', { agentPreset: 'code' }),
    ])
    expect(store.getSnapshot().harness).toEqual({
      permissionPreset: 'workspace-write',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'ask',
      agentPreset: 'code',
    })
  })
})
