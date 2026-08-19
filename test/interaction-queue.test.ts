import { describe, expect, it } from 'vitest'
import { InteractionQueue } from '../src/runtime/interaction-queue.js'

describe('InteractionQueue', () => {
  it('Approval 与 Question 共用严格 FIFO，一次只激活一个', async () => {
    const queue = new InteractionQueue()
    const approval = queue.enqueueApproval({ toolName: 'bash', callId: 'c1' })
    const question = queue.enqueueQuestion({
      questions: [{ id: 'q1', question: '选择？', options: [{ label: 'A' }, { label: 'B' }] }],
    })
    const secondApproval = queue.enqueueApproval({ toolName: 'write', callId: 'c2' })

    const first = queue.getSnapshot()
    expect(first.active).toMatchObject({ kind: 'approval', toolName: 'bash' })
    expect(first.pendingCount).toBe(2)
    if (first.active?.kind !== 'approval') throw new Error('expected approval')
    expect(queue.answerApproval(first.active.id, 'allowed-once')).toBe(true)
    await expect(approval).resolves.toBe('allowed-once')

    const second = queue.getSnapshot()
    expect(second.active).toMatchObject({ kind: 'question' })
    if (second.active?.kind !== 'question') throw new Error('expected question')
    queue.answerQuestion(second.active.id, { answers: [{ id: 'q1', selected: ['B'] }] })
    await expect(question).resolves.toEqual({ answers: [{ id: 'q1', selected: ['B'] }] })

    const third = queue.getSnapshot()
    if (third.active?.kind !== 'approval') throw new Error('expected second approval')
    queue.answerApproval(third.active.id, 'rejected')
    await expect(secondApproval).resolves.toBe('rejected')
    expect(queue.getSnapshot()).toEqual({ active: undefined, pendingCount: 0 })
  })

  it('跳过 Question 会为每题返回空选择', async () => {
    const queue = new InteractionQueue()
    const answer = queue.enqueueQuestion({
      questions: [
        { id: 'one', question: '一？' },
        { id: 'two', question: '二？', multiSelect: true },
      ],
    })
    const active = queue.getSnapshot().active
    if (active?.kind !== 'question') throw new Error('expected question')
    queue.skipQuestion(active.id)
    await expect(answer).resolves.toEqual({
      answers: [
        { id: 'one', selected: [] },
        { id: 'two', selected: [] },
      ],
    })
  })

  it('AbortSignal 取消激活项后继续下一个', async () => {
    const queue = new InteractionQueue()
    const abort = new AbortController()
    const first = queue.enqueueApproval({ toolName: 'bash', signal: abort.signal })
    const second = queue.enqueueApproval({ toolName: 'read' })
    abort.abort()
    await expect(first).resolves.toBe('cancelled')
    const active = queue.getSnapshot().active
    expect(active).toMatchObject({ kind: 'approval', toolName: 'read' })
    if (active?.kind !== 'approval') throw new Error('expected approval')
    queue.answerApproval(active.id, 'allowed-once')
    await expect(second).resolves.toBe('allowed-once')
  })

  it('shutdown 令等待中的 Approval fail-closed，Question 明确失败', async () => {
    const queue = new InteractionQueue()
    const approval = queue.enqueueApproval({ toolName: 'bash' })
    const question = queue.enqueueQuestion({ questions: [{ id: 'q', question: '继续？' }] })
    queue.shutdown()
    await expect(approval).resolves.toBe('unavailable')
    await expect(question).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })
})
