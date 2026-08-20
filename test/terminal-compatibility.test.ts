import type { Terminal } from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vitest'
import {
  CompatibleTerminal,
  normalizeTerminalStringTerminators,
} from '../src/runtime/terminal-compatibility.js'

const ESCAPE = '\u001b'
const BELL = '\u0007'
const STRING_TERMINATOR = `${ESCAPE}\\`

class MemoryTerminal implements Terminal {
  kittyProtocolActive = false
  columns = 80
  rows = 24
  output = ''

  start(_onInput: (data: string) => void, _onResize: () => void): void {}
  stop(): void {}
  async drainInput(): Promise<void> {}
  write(data: string): void {
    this.output += data
  }
  moveBy(_lines: number): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(_title: string): void {}
  setProgress(_active: boolean): void {}
}

describe('终端控制序列兼容', () => {
  it('仅将 OSC 与 APC 的 BEL 终止符替换为 ST', () => {
    const source = [
      `${ESCAPE}]8;;https://example.com${BELL}`,
      '链接',
      `${ESCAPE}]8;;${STRING_TERMINATOR}`,
      `${ESCAPE}_pi:c${BELL}`,
      `保留独立响铃${BELL}`,
    ].join('')

    expect(normalizeTerminalStringTerminators(source)).toBe([
      `${ESCAPE}]8;;https://example.com${STRING_TERMINATOR}`,
      '链接',
      `${ESCAPE}]8;;${STRING_TERMINATOR}`,
      `${ESCAPE}_pi:c${STRING_TERMINATOR}`,
      `保留独立响铃${BELL}`,
    ].join(''))
  })

  it('标题与进度序列不会向宿主发送 BEL', () => {
    vi.useFakeTimers()
    const memory = new MemoryTerminal()
    const terminal = new CompatibleTerminal(memory)
    try {
      terminal.setTitle('dsh')
      terminal.setProgress(true)
      vi.advanceTimersByTime(1_000)
      terminal.setProgress(false)

      expect(memory.output).not.toContain(BELL)
      expect(memory.output).toContain(`${ESCAPE}]0;dsh${STRING_TERMINATOR}`)
      expect(memory.output).toContain(`${ESCAPE}]9;4;3${STRING_TERMINATOR}`)
      expect(memory.output).toContain(`${ESCAPE}]9;4;0${STRING_TERMINATOR}`)
    } finally {
      terminal.stop()
      vi.useRealTimers()
    }
  })
})
