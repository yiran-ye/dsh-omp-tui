import type { Component } from '@earendil-works/pi-tui'
import { theme } from '../theme.js'
import { fitLine, indentLines, wrapPlain } from './common.js'

export class ReasoningBlock implements Component {
  private collapsed = true

  constructor(private readonly text: string) {}

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed
  }

  toggle(): void {
    this.collapsed = !this.collapsed
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const wrapped = wrapPlain(this.text, Math.max(1, safeWidth - 2))
    const visible = this.collapsed ? wrapped.slice(0, 2) : wrapped
    const suffix = this.collapsed && wrapped.length > visible.length ? '  [collapsed]' : ''
    const header = fitLine(theme.dim(`✦ thinking${suffix}`), safeWidth)
    return [header, ...indentLines(visible.map(theme.dim), '  ', safeWidth)]
  }
}
