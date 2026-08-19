import { stripTerminalSequences } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OMP_TUI_PROFILE,
  formatResumeHint,
  resolveLaunchProfile,
} from '../src/runtime/resume-hint.js'

describe('恢复命令提示', () => {
  it('沿用 --profile 的分离参数写法', () => {
    expect(resolveLaunchProfile(['node', 'dsh', '--profile', 'omp-tui-dev', '--resume', 'abc']))
      .toBe('omp-tui-dev')
  })

  it('支持 --profile=<name>，并在缺失时回退默认 Profile', () => {
    expect(resolveLaunchProfile(['node', 'dsh', '--profile=custom-omp'])).toBe('custom-omp')
    expect(resolveLaunchProfile(['node', 'dsh', '--resume', 'abc'])).toBe(DEFAULT_OMP_TUI_PROFILE)
  })

  it('使用短 session ID 生成可复制的恢复命令', () => {
    const plain = stripTerminalSequences(formatResumeHint('session-abc', 'omp-tui-dev'))
    expect(plain).toContain('Resume this session with dsh --profile omp-tui-dev --resume abc')
  })
})
