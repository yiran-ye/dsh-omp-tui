import { Key, matchesKey, type Component } from '@earendil-works/pi-tui'
import { HELP_TEXT } from '../commands.js'
import { theme } from '../theme.js'
import { fitLines, wrapPlain } from './common.js'
import { renderOverlayFrame } from './overlay-frame.js'

export class HelpDialog implements Component {
  private scroll = 0

  constructor(private readonly helpText: string = HELP_TEXT) {}

  invalidate(): void {}

  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) this.scroll = Math.max(0, this.scroll - 1)
    else if (matchesKey(data, Key.down)) this.scroll += 1
    else if (matchesKey(data, Key.pageUp)) this.scroll = Math.max(0, this.scroll - 8)
    else if (matchesKey(data, Key.pageDown)) this.scroll += 8
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const bodyWidth = Math.max(1, safeWidth - 4)
    const lines = wrapPlain(this.helpText, bodyWidth)
    const maxLines = 12
    const maxScroll = Math.max(0, lines.length - maxLines)
    this.scroll = Math.min(this.scroll, maxScroll)
    const visible = lines.slice(this.scroll, this.scroll + maxLines)
    const body = [
      ...visible,
      ...(maxScroll === 0 ? [] : ['', theme.dim(`${this.scroll + 1}-${this.scroll + visible.length}/${lines.length}`)]),
      '',
      theme.dim('↑/↓ 滚动 · PgUp/PgDn 翻页 · Esc 关闭'),
    ]
    return fitLines(renderOverlayFrame('Help', body, safeWidth), safeWidth)
  }
}
