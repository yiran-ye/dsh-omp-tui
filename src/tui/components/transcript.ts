import type { Component } from '@earendil-works/pi-tui'
import type { ToolPresenter } from '../../runtime/tool-presentation.js'
import type { TranscriptEntry, TuiSnapshot } from '../state.js'
import { AssistantBlock } from './assistant-block.js'
import { fitLines } from './common.js'
import { ErrorBlock } from './error-block.js'
import { ToolCard } from './tool-card.js'
import { UserBlock } from './user-block.js'

export class Transcript implements Component {
  private snapshot: TuiSnapshot
  private cache: {
    readonly transcript: readonly TranscriptEntry[]
    readonly reasoningVisible: boolean
    readonly width: number
    readonly lines: string[]
  } | undefined
  private readonly entryCache = new WeakMap<TranscriptEntry, {
    readonly reasoningVisible: boolean
    readonly width: number
    readonly lines: string[]
  }>()
  private readonly streamingAssistants = new Map<string, AssistantBlock>()

  constructor(snapshot: TuiSnapshot, private readonly tools: ToolPresenter) {
    this.snapshot = snapshot
  }

  setSnapshot(snapshot: TuiSnapshot): void {
    if (snapshot.sessionId !== this.snapshot.sessionId || snapshot.lastSeq < this.snapshot.lastSeq) {
      this.streamingAssistants.clear()
    }
    this.snapshot = snapshot
    const activeKeys = new Set(
      snapshot.transcript
        .filter((entry) => entry.kind === 'assistant' && entry.streaming)
        .map((entry) => entry.key),
    )
    for (const key of this.streamingAssistants.keys()) {
      if (!activeKeys.has(key)) this.streamingAssistants.delete(key)
    }
  }

  invalidate(): void {
    this.cache = undefined
    for (const assistant of this.streamingAssistants.values()) assistant.invalidate()
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    if (
      this.cache?.transcript === this.snapshot.transcript
      && this.cache.reasoningVisible === this.snapshot.reasoningVisible
      && this.cache.width === safeWidth
    ) {
      return this.cache.lines
    }
    const lines: string[] = []
    for (const entry of this.snapshot.transcript) {
      if (lines.length > 0) lines.push('')
      lines.push(...this.renderEntry(entry, safeWidth))
    }
    this.cache = {
      transcript: this.snapshot.transcript,
      reasoningVisible: this.snapshot.reasoningVisible,
      width: safeWidth,
      lines,
    }
    return lines
  }

  private renderEntry(entry: TranscriptEntry, width: number): string[] {
    if (entry.kind === 'assistant' && entry.streaming) {
      let component = this.streamingAssistants.get(entry.key)
      if (component === undefined) {
        component = new AssistantBlock(entry, this.snapshot.reasoningVisible)
        this.streamingAssistants.set(entry.key, component)
      } else {
        component.setEntry(entry, this.snapshot.reasoningVisible)
      }
      return fitLines(component.render(width), width)
    }
    const cached = this.entryCache.get(entry)
    if (cached?.width === width && cached.reasoningVisible === this.snapshot.reasoningVisible) return cached.lines
    const component = entry.kind === 'user'
      ? new UserBlock(entry)
      : entry.kind === 'assistant'
        ? new AssistantBlock(entry, this.snapshot.reasoningVisible)
        : entry.kind === 'tool'
          ? new ToolCard(entry, this.tools)
          : new ErrorBlock(entry)
    const lines = fitLines(component.render(width), width)
    this.entryCache.set(entry, { reasoningVisible: this.snapshot.reasoningVisible, width, lines })
    return lines
  }
}
