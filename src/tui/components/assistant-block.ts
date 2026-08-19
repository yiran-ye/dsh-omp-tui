import { Markdown, type Component } from '@earendil-works/pi-tui'
import type { AssistantTranscriptEntry } from '../state.js'
import { markdownTheme, theme } from '../theme.js'
import { fitLine, fitLines, indentLines } from './common.js'
import { ReasoningBlock } from './reasoning-block.js'

export class AssistantBlock implements Component {
  constructor(private readonly entry: AssistantTranscriptEntry) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const lines: string[] = []
    if (this.entry.reasoning.length > 0) {
      lines.push(...new ReasoningBlock(this.entry.reasoning).render(safeWidth), '')
    }
    const streaming = this.entry.streaming ? theme.warning(' …') : ''
    lines.push(fitLine(`${theme.bold(theme.assistant('● DeepSeek'))}${streaming}`, safeWidth))
    if (this.entry.text.length > 0) {
      const bodyWidth = Math.max(1, safeWidth - 2)
      const markdown = new Markdown(this.entry.text, 0, 0, markdownTheme)
      lines.push(...indentLines(fitLines(markdown.render(bodyWidth), bodyWidth), '  ', safeWidth))
    }
    return lines
  }
}
