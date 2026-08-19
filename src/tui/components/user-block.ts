import { Markdown, type Component } from '@earendil-works/pi-tui'
import type { UserTranscriptEntry } from '../state.js'
import { markdownTheme, theme } from '../theme.js'
import { fitLines, paintBackground } from './common.js'

export class UserBlock implements Component {
  constructor(private readonly entry: UserTranscriptEntry) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    if (this.entry.injected) {
      const source = this.entry.sourceLabel ?? '上下文'
      return paintBackground([
        theme.bold(theme.customLabel(`◆ ${source}`)),
        theme.muted(this.entry.text),
      ], safeWidth, theme.customBg)
    }
    const markdown = new Markdown(this.entry.text, 1, 1, markdownTheme, {
      color: theme.text,
      bgColor: theme.userBg,
    })
    return fitLines(markdown.render(safeWidth), safeWidth)
  }
}
