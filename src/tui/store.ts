import type { AgentStatus, ModelSelection } from '@deepseek-ai/dsh-agent'
import { reduceSessionEvent } from './reducer.js'
import {
  createInitialSnapshot,
  type CapabilityState,
  type HarnessStateSnapshot,
  type McpServerConnection,
  type OverlayState,
  type RecentSessionsState,
  type SessionEventLike,
  type StatusLineState,
  type TuiSnapshot,
} from './state.js'

export type StoreListener = (snapshot: TuiSnapshot) => void

const NOTICE_DURATION_MS = 4_000

export class TuiStore {
  private snapshot: TuiSnapshot = createInitialSnapshot()
  private readonly listeners = new Set<StoreListener>()
  private noticeTimer: ReturnType<typeof setTimeout> | undefined
  private noticeVersion = 0

  constructor(events: readonly SessionEventLike[] = []) {
    this.replay(events)
  }

  getSnapshot(): TuiSnapshot {
    return this.snapshot
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  reset(
    events: readonly SessionEventLike[] = [],
    harness: HarnessStateSnapshot = {},
  ): void {
    const initial = createInitialSnapshot()
    this.snapshot = {
      ...initial,
      capabilities: this.snapshot.capabilities,
      harness: { ...harness },
      mcpServers: this.snapshot.mcpServers,
      notice: this.snapshot.notice,
      recentSessions: this.snapshot.recentSessions,
      reasoningVisible: this.snapshot.reasoningVisible,
      statusLine: this.snapshot.statusLine,
    }
    for (const event of events) this.snapshot = reduceSessionEvent(this.snapshot, event)
    this.emit()
  }

  replay(events: readonly SessionEventLike[]): void {
    let next = this.snapshot
    for (const event of events) next = reduceSessionEvent(next, event)
    this.commit(next)
  }

  appendEvent(event: SessionEventLike): void {
    this.commit(reduceSessionEvent(this.snapshot, event))
  }

  setStatus(status: AgentStatus): void {
    this.patch({ status })
  }

  toggleReasoningVisibility(): boolean {
    const reasoningVisible = !this.snapshot.reasoningVisible
    this.patch({ reasoningVisible })
    return reasoningVisible
  }

  setInboxCount(inboxCount: number): void {
    this.patch({ inboxCount: Math.max(0, Math.floor(inboxCount)) })
  }

  setSession(
    sessionId: string,
    provider: string | undefined,
    model: string | undefined,
    reasoningEffort?: ModelSelection['reasoningEffort'],
  ): void {
    this.patch({ sessionId, provider, model, reasoningEffort })
  }

  setStatusLine(statusLine: StatusLineState): void {
    this.patch({ statusLine })
  }

  beginClosing(): void {
    if (this.snapshot.lifecycle === 'closing') return
    this.patch({ lifecycle: 'closing' })
  }

  setCapabilities(capabilities: Partial<CapabilityState>): void {
    this.patch({ capabilities: { ...this.snapshot.capabilities, ...capabilities } })
  }

  setMcpServers(mcpServers: readonly McpServerConnection[]): void {
    this.patch({ mcpServers })
  }

  setNotice(notice: string | undefined): void {
    this.clearNoticeTimer()
    const version = ++this.noticeVersion
    if (notice !== undefined) {
      const timer = setTimeout(() => {
        if (this.noticeVersion !== version) return
        this.noticeTimer = undefined
        if (this.snapshot.notice === notice) this.patch({ notice: undefined })
      }, NOTICE_DURATION_MS)
      timer.unref()
      this.noticeTimer = timer
    }
    if (this.snapshot.notice !== notice) this.patch({ notice })
  }

  clearNotice(): void {
    if (this.snapshot.notice !== undefined) this.setNotice(undefined)
  }

  setOverlay(overlay: OverlayState): void {
    this.patch({ overlay })
  }

  setRecentSessions(recentSessions: RecentSessionsState): void {
    this.patch({ recentSessions })
  }

  private patch(values: Partial<TuiSnapshot>): void {
    this.commit({ ...this.snapshot, ...values })
  }

  private clearNoticeTimer(): void {
    if (this.noticeTimer === undefined) return
    clearTimeout(this.noticeTimer)
    this.noticeTimer = undefined
  }

  private commit(next: TuiSnapshot): void {
    if (next === this.snapshot) return
    this.snapshot = next
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.snapshot)
  }
}
