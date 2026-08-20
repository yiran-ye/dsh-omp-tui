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

const STREAM_COMMIT_INTERVAL_MS = 50
const STREAM_CATCH_UP_LINES = 8
const STREAM_CATCH_UP_AGE_MS = 120

interface StreamEventBatch {
  readonly events: readonly SessionEventLike[]
  readonly lines: number
  readonly enqueuedAt: number
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function countLineBreaks(text: string): number {
  let lines = 0
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code === 10) lines++
    else if (code === 13) {
      lines++
      if (text.charCodeAt(index + 1) === 10) index++
    }
  }
  return lines
}

function completedStreamLines(event: SessionEventLike): number {
  if (!isRecord(event.data) || !isRecord(event.data.chunk)) return 0
  const chunk = event.data.chunk
  const type = chunk.type
  if (type === 'block-end') {
    const text = isRecord(chunk.block) && typeof chunk.block.text === 'string' ? chunk.block.text : ''
    return Math.max(1, countLineBreaks(text))
  }
  if (type !== 'text-delta' && type !== 'reasoning-delta') return 0
  if (typeof chunk.text !== 'string') return 0
  return countLineBreaks(chunk.text)
}

function mergeStreamDelta(
  previous: SessionEventLike | undefined,
  event: SessionEventLike,
): SessionEventLike | undefined {
  if (
    previous === undefined
    || !isRecord(previous.data)
    || !isRecord(previous.data.chunk)
    || !isRecord(event.data)
    || !isRecord(event.data.chunk)
  ) {
    return undefined
  }
  const previousChunk = previous.data.chunk
  const chunk = event.data.chunk
  if (
    (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta')
    || previousChunk.type !== chunk.type
    || previous.data.turn !== event.data.turn
    || previous.data.step !== event.data.step
    || previousChunk.index !== chunk.index
    || typeof previousChunk.text !== 'string'
    || typeof chunk.text !== 'string'
  ) {
    return undefined
  }
  return {
    ...event,
    data: {
      ...event.data,
      chunk: { ...chunk, text: `${previousChunk.text}${chunk.text}` },
    },
  }
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
  private readonly replayPending: SessionEventLike[] = []
  private readonly streamTail: SessionEventLike[] = []
  private readonly streamBatches: StreamEventBatch[] = []
  private streamTimer: ReturnType<typeof setTimeout> | undefined
  private streamTimerCatchUp = false
  private queuedStreamLines = 0
  private replaying = true
  private disconnected = false

  constructor(
    private readonly agent: RuntimeAgent,
    private readonly store: TuiStore,
    source: RuntimeEventSource,
    private readonly onSessionChanged?: () => void,
  ) {
    this.unsubscribers.push(
      source.onSessionEvent((session, event) => {
        if (session !== this.agent.session) return
        if (this.replaying) this.replayPending.push(event)
        else if (event.type === 'assistant/chunk') this.enqueueStreamEvent(event)
        else this.flushStreamEvents(event)
      }),
      source.onAgentStatus((agent, status) => {
        if (agent !== this.agent) return
        this.flushStreamEvents()
        this.store.setStatus(status)
      }),
      source.onAgentInbox((agent) => {
        if (agent === this.agent) this.resnapshotInbox()
      }),
    )

    this.store.reset(this.agent.session.events, {
      ...(this.agent.session.header.agentPreset === undefined
        ? {}
        : { agentPreset: this.agent.session.header.agentPreset }),
    })
    this.replaying = false
    this.replayPending.sort((left, right) => left.seq - right.seq)
    this.store.replay(this.replayPending)
    this.replayPending.length = 0
    this.store.setStatus(this.agent.status)
    this.resnapshotInbox()
    this.onSessionChanged?.()
  }

  disconnect(): void {
    if (this.disconnected) return
    this.flushStreamEvents()
    this.disconnected = true
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe()
  }

  private enqueueStreamEvent(event: SessionEventLike): void {
    const lastIndex = this.streamTail.length - 1
    const merged = mergeStreamDelta(this.streamTail[lastIndex], event)
    if (merged === undefined) this.streamTail.push(event)
    else this.streamTail[lastIndex] = merged
    const completedLines = completedStreamLines(event)
    if (completedLines === 0) return
    this.streamBatches.push({
      events: this.streamTail.splice(0),
      lines: completedLines,
      enqueuedAt: Date.now(),
    })
    this.queuedStreamLines += completedLines
    if (this.queuedStreamLines >= STREAM_CATCH_UP_LINES) {
      this.scheduleStreamFrame(true)
      return
    }
    this.scheduleStreamFrame()
  }

  private scheduleStreamFrame(catchUp = false): void {
    if (this.streamBatches.length === 0) return
    if (this.streamTimer !== undefined) {
      if (!catchUp || this.streamTimerCatchUp) return
      clearTimeout(this.streamTimer)
    }
    this.streamTimerCatchUp = catchUp
    this.streamTimer = setTimeout(() => {
      this.streamTimer = undefined
      this.streamTimerCatchUp = false
      if (!this.disconnected) this.commitStreamFrame()
    }, catchUp ? 0 : STREAM_COMMIT_INTERVAL_MS)
    this.streamTimer.unref()
  }

  private commitStreamFrame(): void {
    if (this.streamBatches.length === 0) return
    this.clearStreamTimer()
    const oldest = this.streamBatches[0]
    const catchUp = this.queuedStreamLines >= STREAM_CATCH_UP_LINES
      || (oldest !== undefined && Date.now() - oldest.enqueuedAt >= STREAM_CATCH_UP_AGE_MS)
    const batchCount = catchUp ? this.streamBatches.length : 1
    const batches = this.streamBatches.splice(0, batchCount)
    const events: SessionEventLike[] = []
    for (const batch of batches) {
      this.queuedStreamLines -= batch.lines
      events.push(...batch.events)
    }
    this.commitEvents(events, false)
    this.scheduleStreamFrame()
  }

  private flushStreamEvents(barrier?: SessionEventLike): void {
    this.clearStreamTimer()
    const events: SessionEventLike[] = []
    for (const batch of this.streamBatches.splice(0)) events.push(...batch.events)
    events.push(...this.streamTail.splice(0))
    this.queuedStreamLines = 0
    if (barrier !== undefined) events.push(barrier)
    this.commitEvents(events)
  }

  private clearStreamTimer(): void {
    if (this.streamTimer === undefined) return
    clearTimeout(this.streamTimer)
    this.streamTimer = undefined
    this.streamTimerCatchUp = false
  }

  private commitEvents(events: readonly SessionEventLike[], notifySessionChanged = true): void {
    if (events.length === 0) return
    const coalesced: SessionEventLike[] = []
    for (const event of events) {
      const lastIndex = coalesced.length - 1
      const merged = mergeStreamDelta(coalesced[lastIndex], event)
      if (merged === undefined) coalesced.push(event)
      else coalesced[lastIndex] = merged
    }
    this.store.replay(coalesced)
    if (notifySessionChanged) this.onSessionChanged?.()
  }

  private resnapshotInbox(): void {
    this.store.setInboxCount(this.agent.inbox.nextStep.length + this.agent.inbox.nextTurn.length)
  }
}
