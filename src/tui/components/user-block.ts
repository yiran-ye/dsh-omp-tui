import { Markdown, type Component } from '@earendil-works/pi-tui'
import type { UserTranscriptEntry } from '../state.js'
import { markdownTheme, theme } from '../theme.js'
import { fitLine, fitLines, indentLines } from './common.js'

export class UserBlock implements Component {
  constructor(private readonly entry: UserTranscriptEntry) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    if (this.entry.injected) {
      return [fitLine(theme.dim(`› ${this.entry.text}`), safeWidth)]
    }
    const bodyWidth = Math.max(1, safeWidth - 2)
    const markdown = new Markdown(this.entry.text, 0, 0, markdownTheme)
    return [
      fitLine(theme.bold('› You'), safeWidth),
      ...indentLines(fitLines(markdown.render(bodyWidth), bodyWidth), '  ', safeWidth),
    ]
  }
}
