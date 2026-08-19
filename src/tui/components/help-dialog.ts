import type { Component } from '@earendil-works/pi-tui'
import { HELP_TEXT } from '../commands.js'
import { theme } from '../theme.js'
import { fitLines, wrapPlain } from './common.js'
import { renderOverlayFrame } from './overlay-frame.js'

export class HelpDialog implements Component {
  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const bodyWidth = Math.max(1, safeWidth - 4)
    const body = [...wrapPlain(HELP_TEXT, bodyWidth), '', theme.dim('Esc 关闭')]
    return fitLines(renderOverlayFrame('Help', body, safeWidth), safeWidth)
  }
}
