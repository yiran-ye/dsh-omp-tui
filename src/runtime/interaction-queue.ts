import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'

export interface ApprovalQueueRequest {
  readonly toolName: string
  readonly callId?: string
  readonly reason?: string
  readonly signal?: AbortSignal
}

export interface ApprovalInteraction {
  readonly kind: 'approval'
  readonly id: number
  readonly toolName: string
  readonly callId: string | undefined
  readonly reason: string | undefined
}

export interface QuestionInteraction {
  readonly kind: 'question'
  readonly id: number
  readonly questions: readonly AskUserQuestionItem[]
}

export type ActiveInteraction = ApprovalInteraction | QuestionInteraction

export interface InteractionSnapshot {
  readonly active: ActiveInteraction | undefined
  readonly pendingCount: number
}

interface ApprovalQueueItem {
  readonly kind: 'approval'
  readonly view: ApprovalInteraction
  readonly signal: AbortSignal | undefined
  readonly onAbort: () => void
  settle(outcome: ApprovalOutcome): void
}

interface QuestionQueueItem {
  readonly kind: 'question'
  readonly view: QuestionInteraction
  readonly signal: AbortSignal | undefined
  readonly onAbort: () => void
  settle(answer: AskUserQuestionAnswer): void
  fail(error: UserQuestionError): void
}

type QueueItem = ApprovalQueueItem | QuestionQueueItem
type InteractionListener = (snapshot: InteractionSnapshot) => void

export class InteractionQueue {
  private readonly pending: QueueItem[] = []
  private readonly listeners = new Set<InteractionListener>()
  private active: QueueItem | undefined
  private nextId = 1

  getSnapshot(): InteractionSnapshot {
    return { active: this.active?.view, pendingCount: this.pending.length }
  }

  subscribe(listener: InteractionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  enqueueApproval(request: ApprovalQueueRequest): Promise<ApprovalOutcome> {
    if (request.signal?.aborted) return Promise.resolve('cancelled')
    return new Promise((resolve) => {
      let settled = false
      const settle = (outcome: ApprovalOutcome): void => {
        if (settled) return
        settled = true
        this.retire(item)
        resolve(outcome)
      }
      const item: ApprovalQueueItem = {
        kind: 'approval',
        view: {
          kind: 'approval',
          id: this.nextId++,
          toolName: request.toolName,
          callId: request.callId,
          reason: request.reason,
        },
        signal: request.signal,
        onAbort: () => settle('cancelled'),
        settle,
      }
      this.enqueue(item)
    })
  }

  enqueueQuestion(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    if (request.signal?.aborted) {
      return Promise.reject(new UserQuestionError('用户问题已取消。', 'QUESTION_CANCELLED'))
    }
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (): boolean => {
        if (settled) return false
        settled = true
        this.retire(item)
        return true
      }
      const item: QuestionQueueItem = {
        kind: 'question',
        view: {
          kind: 'question',
          id: this.nextId++,
          questions: request.questions.map((question) => ({ ...question })),
        },
        signal: request.signal,
        onAbort: () => {
          if (finish()) reject(new UserQuestionError('用户问题已取消。', 'QUESTION_CANCELLED'))
        },
        settle: (answer) => {
          if (finish()) resolve(answer)
        },
        fail: (error) => {
          if (finish()) reject(error)
        },
      }
      this.enqueue(item)
    })
  }

  answerApproval(id: number, outcome: ApprovalOutcome): boolean {
    if (this.active?.kind !== 'approval' || this.active.view.id !== id) return false
    this.active.settle(outcome)
    return true
  }

  answerQuestion(id: number, answer: AskUserQuestionAnswer): boolean {
    if (this.active?.kind !== 'question' || this.active.view.id !== id) return false
    this.active.settle(answer)
    return true
  }

  skipQuestion(id: number): boolean {
    if (this.active?.kind !== 'question' || this.active.view.id !== id) return false
    this.active.settle({
      answers: this.active.view.questions.map((question) => ({ id: question.id, selected: [] })),
    })
    return true
  }

  shutdown(): void {
    const items = [...(this.active === undefined ? [] : [this.active]), ...this.pending]
    for (const item of items) {
      if (item.kind === 'approval') item.settle('unavailable')
      else item.fail(new UserQuestionError('TUI 已关闭。', 'PROVIDER_UNAVAILABLE'))
    }
  }

  private enqueue(item: QueueItem): void {
    item.signal?.addEventListener('abort', item.onAbort, { once: true })
    this.pending.push(item)
    this.advance()
  }

  private retire(item: QueueItem): void {
    item.signal?.removeEventListener('abort', item.onAbort)
    if (this.active === item) {
      this.active = undefined
      this.advance()
      return
    }
    const index = this.pending.indexOf(item)
    if (index !== -1) this.pending.splice(index, 1)
    this.emit()
  }

  private advance(): void {
    this.active ??= this.pending.shift()
    this.emit()
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
