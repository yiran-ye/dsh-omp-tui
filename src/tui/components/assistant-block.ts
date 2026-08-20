import { Markdown, type Component } from '@earendil-works/pi-tui'
import type { AssistantTranscriptEntry } from '../state.js'
import { markdownTheme, theme } from '../theme.js'
import { fitLines } from './common.js'
import { ReasoningBlock } from './reasoning-block.js'

export class AssistantBlock implements Component {
  constructor(
    private readonly entry: AssistantTranscriptEntry,
    private readonly reasoningVisible: boolean,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const lines: string[] = []
    if (this.entry.reasoning.length > 0 && this.reasoningVisible) {
      lines.push(...new ReasoningBlock(this.entry.reasoning, true).render(safeWidth))
      if (this.entry.text.length > 0) lines.push('')
    }
    if (this.entry.text.length > 0) {
      const markdown = new Markdown(this.entry.text, 1, 0, markdownTheme, { color: theme.text })
      lines.push(...fitLines(markdown.render(safeWidth), safeWidth))
    }
    return lines
  }
}
