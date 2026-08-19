import { Key, matchesKey, type Component } from '@earendil-works/pi-tui'
import type { ToolPresenter } from '../../runtime/tool-presentation.js'
import type { ToolTranscriptEntry } from '../state.js'
import { theme } from '../theme.js'
import { fitLines, wrapPlain } from './common.js'
import { renderOverlayFrame } from './overlay-frame.js'

interface ExpandedToolDetail {
  readonly entry: ToolTranscriptEntry
  readonly presenter: ToolPresenter
  readonly bodyWidth: number
  readonly title: string
  readonly lines: readonly string[]
}

export class ToolDetailDialog implements Component {
  private selected: number
  private scroll = 0
  private expandedDetail: ExpandedToolDetail | undefined

  constructor(
    private readonly entries: readonly ToolTranscriptEntry[],
    initialSelected: number,
    private readonly onClose: () => void,
  ) {
    this.selected = Math.max(0, Math.min(initialSelected, entries.length - 1))
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.selected = Math.max(0, this.selected - 1)
      this.scroll = 0
    } else if (matchesKey(data, Key.down)) {
      this.selected = Math.min(this.entries.length - 1, this.selected + 1)
      this.scroll = 0
    } else if (matchesKey(data, Key.pageUp)) {
      this.scroll = Math.max(0, this.scroll - 8)
    } else if (matchesKey(data, Key.pageDown)) {
      this.scroll += 8
    } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('o'))) {
      this.onClose()
    }
  }

  render(width: number, presenter?: ToolPresenter): string[] {
    const safeWidth = Math.max(1, width)
    const bodyWidth = Math.max(1, safeWidth - 4)
    const entry = this.entries[this.selected]
    if (entry === undefined || presenter === undefined) {
      return renderOverlayFrame('Tools', [theme.dim('当前 Session 还没有工具调用。'), '', theme.dim('Esc 关闭')], safeWidth)
    }
    const expandedDetail = this.getExpandedDetail(entry, presenter, bodyWidth)
    const expanded = expandedDetail.lines
    const maxLines = 18
    const maxScroll = Math.max(0, expanded.length - maxLines)
    this.scroll = Math.min(this.scroll, maxScroll)
    const visible = expanded.slice(this.scroll, this.scroll + maxLines)
    const progress = `${this.selected + 1}/${this.entries.length}`
    const body = [
      theme.bold(`${expandedDetail.title} · ${progress}`),
      '',
      ...visible,
      ...(maxScroll > 0 ? ['', theme.dim(`详情 ${this.scroll + 1}-${this.scroll + visible.length}/${expanded.length}`)] : []),
      '',
      theme.dim('↑/↓ 切换工具 · PgUp/PgDn 滚动 · Ctrl+O/Esc 关闭'),
    ]
    return fitLines(renderOverlayFrame('Tool Detail', body, safeWidth), safeWidth)
  }

  private getExpandedDetail(entry: ToolTranscriptEntry, presenter: ToolPresenter, bodyWidth: number): ExpandedToolDetail {
    const cached = this.expandedDetail
    if (cached?.entry === entry && cached.presenter === presenter && cached.bodyWidth === bodyWidth) return cached
    const presented = presenter.present(entry)
    const next: ExpandedToolDetail = {
      entry,
      presenter,
      bodyWidth,
      title: presented.title,
      lines: presented.detailLines.flatMap((line) => wrapPlain(line, bodyWidth)),
    }
    this.expandedDetail = next
    return next
  }
}

export class BoundToolDetailDialog implements Component {
  private readonly dialog: ToolDetailDialog

  constructor(
    entries: readonly ToolTranscriptEntry[],
    selected: number,
    private readonly presenter: ToolPresenter,
    onClose: () => void,
  ) {
    this.dialog = new ToolDetailDialog(entries, selected, onClose)
  }

  invalidate(): void {
    this.dialog.invalidate()
  }

  handleInput(data: string): void {
    this.dialog.handleInput(data)
  }

  render(width: number): string[] {
    return this.dialog.render(width, this.presenter)
  }
}
