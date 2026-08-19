import {
  stripTerminalSequences,
  TuiMainScreen,
  type Terminal,
  visibleWidth,
} from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'
import { ToolPresenter } from '../src/runtime/tool-presentation.js'
import { App } from '../src/tui/components/app.js'
import { StatusLine } from '../src/tui/components/status-line.js'
import { ToolCard } from '../src/tui/components/tool-card.js'
import { UserBlock } from '../src/tui/components/user-block.js'
import { HelpDialog } from '../src/tui/components/help-dialog.js'
import { TuiStore } from '../src/tui/store.js'
import type { ToolTranscriptEntry } from '../src/tui/state.js'

class MemoryTerminal implements Terminal {
  kittyProtocolActive = false
  columns = 48
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

function assertWidth(lines: readonly string[], width: number): void {
  for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width)
}

describe('OMP 风格渲染', () => {
  it('中文、Emoji 与 ANSI 文本都遵守传入宽度', () => {
    const user = new UserBlock({
      kind: 'user',
      key: 'user:0',
      seq: 0,
      text: '你好，世界🙂。这是一段会换行的中文文本。',
      injected: false,
    })
    for (const width of [8, 12, 20, 40]) assertWidth(user.render(width), width)
  })

  it('窄终端状态栏自动降级', () => {
    const store = new TuiStore()
    store.setSession('session-x', 'deepseek', 'deepseek-chat')
    store.setStatus('running')
    for (const width of [4, 8, 16, 32]) {
      const lines = new StatusLine(store.getSnapshot()).render(width)
      expect(lines).toHaveLength(1)
      assertWidth(lines, width)
    }
  })

  it('Tool Card 截断摘要且保留详情', () => {
    const entry: ToolTranscriptEntry = {
      kind: 'tool',
      key: 'tool:c1',
      seq: 2,
      callId: 'c1',
      name: 'bash',
      arguments: '{"cmd":"printf 你好"}',
      result: Array.from({ length: 20 }, (_, index) => `第 ${index + 1} 行`).join('\n'),
      resultMeta: undefined,
      status: 'success',
      startedAt: 10,
      durationMs: 81,
    }
    const presenter = new ToolPresenter(undefined, 4)
    const presented = presenter.present(entry)
    expect(presented.summaryLines.at(-1)).toContain('more lines')
    expect(presented.detailLines.length).toBeGreaterThan(presented.summaryLines.length)
    assertWidth(new ToolCard(entry, presenter).render(24), 24)
  })

  it('使用工具自带 presentCall/presentResult', () => {
    const presenter = new ToolPresenter({
      get: () => ({
        presentCall: () => ({ card: 'terminal', title: 'git status', cwd: '/repo' }),
        presentResult: () => ({ card: 'terminal', title: 'git status', output: 'clean', exitCode: 0 }),
      }),
    })
    const entry: ToolTranscriptEntry = {
      kind: 'tool',
      key: 'tool:c2',
      seq: 3,
      callId: 'c2',
      name: 'bash',
      arguments: '{"cmd":"git status"}',
      result: 'raw',
      resultMeta: undefined,
      status: 'success',
      startedAt: 10,
      durationMs: 12,
    }
    expect(presenter.present(entry)).toMatchObject({
      kind: 'terminal',
      title: 'git status',
      summaryLines: ['clean'],
    })
  })

  it('固定尺寸主屏组合渲染保持宽度并包含标识', () => {
    const terminal = new MemoryTerminal()
    terminal.columns = 32
    const tui = new TuiMainScreen(terminal, true)
    const store = new TuiStore([
      {
        type: 'user/message',
        seq: 0,
        time: 0,
        data: { content: [{ type: 'text', text: '检查当前项目' }], source: { kind: 'user' } },
      },
      {
        type: 'assistant/message',
        seq: 1,
        time: 1,
        data: {
          turn: 1,
          step: 1,
          message: { content: [{ type: 'text', text: '项目状态正常。' }] },
        },
      },
    ])
    const app = new App(tui, store, new ToolPresenter(undefined), () => undefined)
    tui.addChild(app)
    tui.setFocus(app.prompt.input)
    const lines = app.render(32)
    assertWidth(lines, 32)
    const plain = lines.map(stripTerminalSequences).join('\n')
    expect(plain).toContain('› You')
    expect(plain).toContain('● DeepSeek')
    expect(plain).toContain('╭')
    expect(plain).toContain('输入任务…')
    app.dispose()
  })

  it('Slash 补全菜单会完整显示且可选择第五项', async () => {
    const terminal = new MemoryTerminal()
    terminal.columns = 64
    const tui = new TuiMainScreen(terminal, true)
    const store = new TuiStore()
    const submitted: string[] = []
    const app = new App(tui, store, new ToolPresenter(undefined), (text) => submitted.push(text))
    tui.addChild(app)
    tui.setFocus(app.prompt.input)

    app.prompt.input.handleInput('/')
    await new Promise<void>((resolve) => setImmediate(resolve))

    const plain = app.render(64).map(stripTerminalSequences).join('\n')
    expect(plain).toContain('help')
    expect(plain).toContain('tools')
    expect(plain).toContain('skills')
    expect(plain).toContain('mcp')
    expect(plain).toContain('clear')

    for (let index = 0; index < 9; index++) app.prompt.input.handleInput('\u001b[B')
    const selectedPlain = app.render(64).map(stripTerminalSequences).join('\n')
    expect(selectedPlain).toContain('quit')
    app.prompt.input.handleInput('\r')
    expect(submitted).toEqual(['/quit'])
    app.dispose()
  })

  it('长命令帮助可滚动查看', () => {
    const help = new HelpDialog(Array.from({ length: 20 }, (_, index) => `/command-${index + 1}  说明`).join('\n'))
    expect(help.render(48).map(stripTerminalSequences).join('\n')).toContain('/command-1')
    for (let index = 0; index < 12; index++) help.handleInput('\u001b[B')
    expect(help.render(48).map(stripTerminalSequences).join('\n')).toContain('/command-20')
  })
})
