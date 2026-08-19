import type { Component } from '@earendil-works/pi-tui'
import type { ToolPresenter } from '../../runtime/tool-presentation.js'
import type { ToolTranscriptEntry } from '../state.js'
import { theme } from '../theme.js'
import { fitLine, paintBackground, wrapPlain } from './common.js'

export class ToolCard implements Component {
  constructor(private readonly entry: ToolTranscriptEntry, private readonly presenter: ToolPresenter) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const presented = this.presenter.presentSummary(this.entry)
    const marker = this.entry.status === 'running'
      ? theme.warning('⟳')
      : this.entry.status === 'success'
        ? theme.success('✔')
        : theme.error('✘')
    const state = this.entry.status === 'running'
      ? theme.warning('运行中')
      : this.entry.status === 'success'
        ? theme.success('已完成')
        : theme.error('失败')
    const duration = this.entry.durationMs === undefined ? '' : ` · ${this.entry.durationMs}ms`
    const title = fitLine(`${marker} ${theme.bold(theme.text(presented.title))}`, Math.max(1, safeWidth - 2))
    const meta = fitLine(`${theme.borderMuted('└─')} ${state}${theme.dim(`${duration} · ${kindLabel(presented.kind)}`)}`, Math.max(1, safeWidth - 2))
    const body = presented.summaryLines
      .flatMap((line) => wrapPlain(line, Math.max(1, safeWidth - 2)))
      .map((line) => {
        if (presented.kind === 'diff' && line.startsWith('+')) return theme.diffAdded(line)
        if (presented.kind === 'diff' && line.startsWith('-')) return theme.diffRemoved(line)
        return theme.muted(line)
      })
    const background = this.entry.status === 'running'
      ? theme.toolPendingBg
      : this.entry.status === 'success'
        ? theme.toolSuccessBg
        : theme.toolErrorBg
    return paintBackground([title, meta, ...body], safeWidth, background)
  }
}

function kindLabel(kind: ReturnType<ToolPresenter['presentSummary']>['kind']): string {
  switch (kind) {
    case 'terminal': return '终端'
    case 'diff': return '差异'
    case 'read': return '读取'
    case 'search': return '搜索'
    case 'web': return '网页'
    case 'generic': return '工具'
  }
}
