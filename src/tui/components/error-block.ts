import type { Component } from '@earendil-works/pi-tui'
import type { ErrorTranscriptEntry } from '../state.js'
import { theme } from '../theme.js'
import { paintBackground, wrapPlain } from './common.js'

export class ErrorBlock implements Component {
  constructor(private readonly entry: ErrorTranscriptEntry) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const title = `✘ 请求失败${this.entry.code === undefined ? '' : ` · ${this.entry.code}`}`
    const bodyWidth = Math.max(1, safeWidth - 2)
    return paintBackground([
      theme.bold(theme.error(title)),
      ...wrapPlain(this.entry.text, bodyWidth).map(theme.error),
    ], safeWidth, theme.toolErrorBg)
  }
}
