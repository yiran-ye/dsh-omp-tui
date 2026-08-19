import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'
import { CombinedAutocompleteProvider } from '@earendil-works/pi-tui'
import {
  InputPolicy,
  parseSlashCommand,
  SLASH_COMMAND_AUTOCOMPLETE_ITEMS,
  type InputContext,
} from '../src/tui/commands.js'

function context(status: AgentStatus, input = '') {
  return {
    status,
    input,
    overlayOpen: false,
    clearInput: vi.fn<() => void>(),
    cancel: vi.fn<() => void>(),
    exit: vi.fn<() => void>(),
    openTools: vi.fn<() => void>(),
    closeOverlay: vi.fn<() => void>(),
    notice: vi.fn<(message: string) => void>(),
  } satisfies InputContext
}

describe('输入策略与 Slash Commands', () => {
  it('解析 MVP 命令', () => {
    expect(parseSlashCommand('/help')).toBe('help')
    expect(parseSlashCommand('/TOOLS now')).toBe('tools')
    expect(parseSlashCommand('/clear')).toBe('clear')
    expect(parseSlashCommand('/exit')).toBe('exit')
    expect(parseSlashCommand('/quit')).toBe('quit')
    expect(parseSlashCommand('/unknown')).toBeUndefined()
  })

  it('输入 / 时列出全部已注册命令', async () => {
    const provider = new CombinedAutocompleteProvider([...SLASH_COMMAND_AUTOCOMPLETE_ITEMS], process.cwd())
    const suggestions = await provider.getSuggestions(['/'], 0, 1, {
      signal: new AbortController().signal,
    })

    expect(suggestions?.prefix).toBe('/')
    expect(suggestions?.items.map((item) => item.value)).toEqual(['help', 'tools', 'clear', 'exit', 'quit'])
  })

  it('Ctrl+C 在 running 时取消任务', () => {
    const policy = new InputPolicy()
    const state = context('running')
    expect(policy.handle('\u0003', state)).toEqual({ consume: true })
    expect(state.cancel).toHaveBeenCalledOnce()
    expect(state.exit).not.toHaveBeenCalled()
  })

  it('Ctrl+C 在 idle 且有输入时清空输入', () => {
    const policy = new InputPolicy()
    const state = context('idle', 'draft')
    policy.handle('\u0003', state)
    expect(state.clearInput).toHaveBeenCalledOnce()
    expect(state.exit).not.toHaveBeenCalled()
  })

  it('idle 空输入需要连续两次 Ctrl+C 才退出', () => {
    let time = 100
    const policy = new InputPolicy(() => time)
    const state = context('idle')
    policy.handle('\u0003', state)
    expect(state.exit).not.toHaveBeenCalled()
    time += 500
    policy.handle('\u0003', state)
    expect(state.exit).toHaveBeenCalledOnce()
  })

  it('idle 空输入需要连续两次 Ctrl+D 才退出', () => {
    let time = 100
    const policy = new InputPolicy(() => time)
    const state = context('idle')
    policy.handle('\u0004', state)
    time += 500
    policy.handle('\u0004', state)
    expect(state.exit).toHaveBeenCalledOnce()
  })
})
