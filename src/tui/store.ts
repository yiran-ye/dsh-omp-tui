import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import { reduceSessionEvent } from './reducer.js'
import {
  createInitialSnapshot,
  type CapabilityState,
  type OverlayState,
  type RecentSessionsState,
  type SessionEventLike,
  type StatusLineState,
  type TuiSnapshot,
} from './state.js'

export type StoreListener = (snapshot: TuiSnapshot) => void

export class TuiStore {
  private snapshot: TuiSnapshot = createInitialSnapshot()
  private readonly listeners = new Set<StoreListener>()

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

  reset(events: readonly SessionEventLike[] = []): void {
    const initial = createInitialSnapshot()
    this.snapshot = {
      ...initial,
      capabilities: this.snapshot.capabilities,
      notice: this.snapshot.notice,
      recentSessions: this.snapshot.recentSessions,
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

  setInboxCount(inboxCount: number): void {
    this.patch({ inboxCount: Math.max(0, Math.floor(inboxCount)) })
  }

  setSession(sessionId: string, provider: string | undefined, model: string | undefined): void {
    this.patch({ sessionId, provider, model })
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

  setNotice(notice: string | undefined): void {
    this.patch({ notice })
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

  private commit(next: TuiSnapshot): void {
    if (next === this.snapshot) return
    this.snapshot = next
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.snapshot)
  }
}
