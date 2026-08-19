import { describe, expect, it, vi } from 'vitest'
import { TerminalRestore, assertInteractiveTerminal } from '../src/runtime/terminal-restore.js'

describe('终端恢复', () => {
  it('停止 TUI、关闭 raw mode、显示光标且只执行一次', () => {
    const stop = vi.fn()
    const setRawMode = vi.fn()
    const write = vi.fn()
    const restore = new TerminalRestore(stop, {
      stdin: { isTTY: true, setRawMode },
      stdout: { isTTY: true, write },
    })
    restore.restore()
    restore.restore()
    expect(stop).toHaveBeenCalledOnce()
    expect(setRawMode).toHaveBeenCalledOnce()
    expect(setRawMode).toHaveBeenCalledWith(false)
    expect(write).toHaveBeenCalledOnce()
    expect(write.mock.calls[0]?.[0]).toContain('\u001b[?25h')
    expect(write.mock.calls[0]?.[0]).toContain('\u001b[?2004l')
    expect(write.mock.calls[0]?.[0]).toContain('\u001b[?2026l')
  })

  it('非 TTY 给出 headless 提示', () => {
    expect(() => assertInteractiveTerminal(
      { isTTY: false },
      { isTTY: true },
    )).toThrow('headless Profile')
  })
})
