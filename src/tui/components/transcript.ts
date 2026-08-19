import type { Component } from '@earendil-works/pi-tui'
import type { ToolPresenter } from '../../runtime/tool-presentation.js'
import type { TuiSnapshot } from '../state.js'
import { AssistantBlock } from './assistant-block.js'
import { fitLines } from './common.js'
import { ToolCard } from './tool-card.js'
import { UserBlock } from './user-block.js'

export class Transcript implements Component {
  constructor(private readonly snapshot: TuiSnapshot, private readonly tools: ToolPresenter) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const lines: string[] = []
    for (const entry of this.snapshot.transcript) {
      if (lines.length > 0) lines.push('')
      const component = entry.kind === 'user'
        ? new UserBlock(entry)
        : entry.kind === 'assistant'
          ? new AssistantBlock(entry)
          : new ToolCard(entry, this.tools)
      lines.push(...component.render(safeWidth))
    }
    return fitLines(lines, safeWidth)
  }
}
