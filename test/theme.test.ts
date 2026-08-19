import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'
import { createTheme, resolveColorMode } from '../src/tui/theme.js'

describe('OMP 语义主题', () => {
  it('按终端能力选择 truecolor、256 色与 ANSI-16', () => {
    expect(resolveColorMode(true, 'xterm')).toBe('truecolor')
    expect(resolveColorMode(false, 'xterm-256color')).toBe('ansi256')
    expect(resolveColorMode(false, 'vt100')).toBe('ansi16')
  })

  it('三档主题都输出相应颜色序列', () => {
    expect(createTheme('truecolor').accent('x')).toContain('\u001b[38;2;')
    expect(createTheme('ansi256').accent('x')).toContain('\u001b[38;5;')
    expect(createTheme('ansi16').accent('x')).toContain('\u001b[93m')
    expect(createTheme('truecolor').userBg('x')).toContain('\u001b[48;2;')
  })

  it('静态渐变不改变文字内容与显示宽度', () => {
    const source = 'DSH 终端'
    for (const mode of ['truecolor', 'ansi256', 'ansi16'] as const) {
      const rendered = createTheme(mode).gradient(source)
      expect(stripTerminalSequences(rendered)).toBe(source)
      expect(visibleWidth(rendered)).toBe(visibleWidth(source))
    }
  })
})
