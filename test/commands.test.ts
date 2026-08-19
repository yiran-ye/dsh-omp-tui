import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'
import { CombinedAutocompleteProvider } from '@earendil-works/pi-tui'
import {
  formatHelpText,
  InputPolicy,
  mergeSlashCommandAutocompleteItems,
  parseSlashCommand,
  SLASH_COMMAND_AUTOCOMPLETE_ITEMS,
  type InputContext,
} from '../src/tui/commands.js'

function context(status: AgentStatus, input = '') {
  return {
    status,
    input,
    overlayOpen: false,
    commandRunning: false,
    clearInput: vi.fn<() => void>(),
    cancel: vi.fn<() => void>(),
    cancelCommand: vi.fn<() => void>(),
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
    expect(parseSlashCommand('/skills')).toBe('skills')
    expect(parseSlashCommand('/mcp')).toBe('mcp')
    expect(parseSlashCommand('/model')).toBe('model')
    expect(parseSlashCommand('/clear')).toBe('clear')
    expect(parseSlashCommand('/new')).toBe('new')
    expect(parseSlashCommand('/retry')).toBe('retry')
    expect(parseSlashCommand('/hotkeys')).toBe('hotkeys')
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
    expect(suggestions?.items.map((item) => item.value)).toEqual([
      'help', 'tools', 'skills', 'mcp', 'model', 'clear', 'new', 'retry', 'hotkeys', 'exit', 'quit',
    ])
  })

  it('优先显示 Harness 注册表命令，随后是本地命令和可调用 Skills', () => {
    const commands = mergeSlashCommandAutocompleteItems([
      { name: 'goal', description: '管理长任务目标', input: { hint: '<objective>' } },
      { name: 'help', description: '不应覆盖本地帮助' },
      { name: 'compact', description: '压缩上下文' },
    ], [
      { name: 'release-notes', description: '生成发布说明' },
      { name: 'help', description: '不应覆盖本地帮助' },
    ])

    expect(commands.map((command) => command.name)).toEqual([
      'goal', 'help', 'compact', 'tools', 'skills', 'mcp', 'model', 'clear', 'new', 'retry', 'hotkeys', 'exit', 'quit',
      'release-notes',
    ])
    expect(commands.find((command) => command.name === 'goal')).toMatchObject({ argumentHint: '<objective>' })
    expect(commands.find((command) => command.name === 'help')).toMatchObject({ description: '显示命令和快捷键' })
    expect(formatHelpText(commands)).toContain('/compact  压缩上下文')
    expect(formatHelpText(commands)).toContain('/release-notes  生成发布说明')
  })

  it('Ctrl+C 在 running 时取消任务', () => {
    const policy = new InputPolicy()
    const state = context('running')
    expect(policy.handle('\u0003', state)).toEqual({ consume: true })
    expect(state.cancel).toHaveBeenCalledOnce()
    expect(state.exit).not.toHaveBeenCalled()
  })

  it('Esc 与 Ctrl+C 都会取消正在执行的 Slash Command', () => {
    const policy = new InputPolicy()
    const state = { ...context('idle'), commandRunning: true }
    expect(policy.handle('\u001b', state)).toEqual({ consume: true })
    expect(state.cancelCommand).toHaveBeenCalledOnce()

    policy.handle('\u0003', state)
    expect(state.cancelCommand).toHaveBeenCalledTimes(2)
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
