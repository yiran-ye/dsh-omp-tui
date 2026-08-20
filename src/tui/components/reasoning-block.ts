import type { Component } from '@earendil-works/pi-tui'
import { theme } from '../theme.js'
import { fitLine, indentLines, wrapPlain } from './common.js'

export class ReasoningBlock implements Component {
  constructor(private readonly text: string, private readonly visible: boolean) {}

  invalidate(): void {}

  render(width: number): string[] {
    if (!this.visible) return []
    const safeWidth = Math.max(1, width)
    const wrapped = wrapPlain(this.text, Math.max(1, safeWidth - 2))
    const header = fitLine(theme.muted('✦ 思考'), safeWidth)
    return [header, ...indentLines(wrapped.map((line) => theme.italic(theme.thinking(line))), '  ', safeWidth)]
  }
}
