import type { Component } from '@earendil-works/pi-tui'
import type { ToolPresenter } from '../../runtime/tool-presentation.js'
import type { ToolTranscriptEntry } from '../state.js'
import { theme } from '../theme.js'
import { fitLine, indentLines, wrapPlain } from './common.js'

export class ToolCard implements Component {
  constructor(private readonly entry: ToolTranscriptEntry, private readonly presenter: ToolPresenter) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const presented = this.presenter.presentSummary(this.entry)
    const marker = this.entry.status === 'running'
      ? theme.warning('●')
      : this.entry.status === 'success'
        ? theme.success('●')
        : theme.error('●')
    const state = this.entry.status === 'running'
      ? theme.warning('running')
      : this.entry.status === 'success'
        ? theme.success('✓ completed')
        : theme.error('✕ failed')
    const duration = this.entry.durationMs === undefined ? '' : theme.dim(` · ${this.entry.durationMs}ms`)
    const title = fitLine(`${marker} ${theme.bold(presented.title)}`, safeWidth)
    const meta = fitLine(`  ${state}${duration} ${theme.dim(`· ${presented.kind}`)}`, safeWidth)
    const body = presented.summaryLines.flatMap((line) => wrapPlain(line, Math.max(1, safeWidth - 2)))
    return [title, meta, ...indentLines(body.map(theme.dim), '  ', safeWidth)]
  }
}
