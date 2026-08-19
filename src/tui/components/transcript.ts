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
  private cache: { readonly transcript: readonly TranscriptEntry[]; readonly width: number; readonly lines: string[] } | undefined
  private readonly entryCache = new WeakMap<TranscriptEntry, { readonly width: number; readonly lines: string[] }>()

  constructor(snapshot: TuiSnapshot, private readonly tools: ToolPresenter) {
    this.snapshot = snapshot
  }

  setSnapshot(snapshot: TuiSnapshot): void {
    this.snapshot = snapshot
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    if (this.cache?.transcript === this.snapshot.transcript && this.cache.width === safeWidth) {
      return this.cache.lines
    }
    const lines: string[] = []
    for (const entry of this.snapshot.transcript) {
      if (lines.length > 0) lines.push('')
      lines.push(...this.renderEntry(entry, safeWidth))
    }
    this.cache = { transcript: this.snapshot.transcript, width: safeWidth, lines }
    return lines
  }

  private renderEntry(entry: TranscriptEntry, width: number): string[] {
    const cached = this.entryCache.get(entry)
    if (cached?.width === width) return cached.lines
    const component = entry.kind === 'user'
      ? new UserBlock(entry)
      : entry.kind === 'assistant'
        ? new AssistantBlock(entry)
        : entry.kind === 'tool'
          ? new ToolCard(entry, this.tools)
          : new ErrorBlock(entry)
    const lines = fitLines(component.render(width), width)
    this.entryCache.set(entry, { width, lines })
    return lines
  }
}
