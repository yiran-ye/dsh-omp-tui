import {
  Key,
  stripTerminalSequences,
  TuiMainScreen,
  type Terminal,
  visibleWidth,
} from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vitest'
import { ToolPresenter } from '../src/runtime/tool-presentation.js'
import { App } from '../src/tui/components/app.js'
import { StatusLine } from '../src/tui/components/status-line.js'
import { ToolCard } from '../src/tui/components/tool-card.js'
import { ToolDetailDialog } from '../src/tui/components/tool-detail-dialog.js'
import { UserBlock } from '../src/tui/components/user-block.js'
import { Welcome } from '../src/tui/components/welcome.js'
import { formatWorkingElapsed, resolveWorkingActivity } from '../src/tui/components/working-status.js'
import { HelpDialog } from '../src/tui/components/help-dialog.js'
import { SLASH_COMMAND_AUTOCOMPLETE_ITEMS } from '../src/tui/commands.js'
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
    const plain = new StatusLine(new TuiStore().getSnapshot()).render(80).map(stripTerminalSequences).join('')
    expect(plain).not.toContain('provider/model')
    expect(plain).not.toContain('ctx --')
  })

  it('Welcome 使用双栏布局且不展示未实现的能力', () => {
    const store = new TuiStore()
    store.setSession('session-x', 'deepseek', 'deepseek-chat')
    store.setRecentSessions({
      status: 'ready',
      items: [{ id: 'session-old', label: '修复欢迎页布局', timeAgo: '3 分钟前', timestamp: 1 }],
    })
    store.setMcpServers([{ name: 'context7', phase: 'connecting', toolCount: 0 }])
    const lines = new Welcome(store.getSnapshot()).render(80)
    const plain = lines.map(stripTerminalSequences).join('\n')
    assertWidth(lines, 80)
    expect(plain).toContain('dsh-omp-tui v')
    expect(plain).toContain('欢迎回来！')
    expect(plain).toContain('deepseek-chat')
    expect(plain).toContain('deepseek')
    expect(plain).toContain('快捷提示')
    expect(plain).toContain('最近会话')
    expect(plain).toContain('修复欢迎页布局')
    expect(plain).toContain('MCP')
    expect(plain).toContain('context7')
    expect(plain).toContain('Connecting')
    expect(plain).toContain('输入 /help')
    expect(plain).not.toContain('LSP Servers')
    expect(plain).not.toContain('LSP')
    expect(lines.some((line) => stripTerminalSequences(line).split('│').length >= 4)).toBe(true)
  })

  it('Welcome 在窄终端退化为单栏且不会溢出', () => {
    const lines = new Welcome(new TuiStore().getSnapshot()).render(32)
    assertWidth(lines, 32)
    expect(lines.every((line) => stripTerminalSequences(line).split('│').length <= 3)).toBe(true)
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
    const summary = presenter.presentSummary(entry)
    expect(presented.summaryLines.at(-1)).toContain('另有')
    expect(presented.detailLines.length).toBeGreaterThan(presented.summaryLines.length)
    expect(summary.summaryLines).toEqual(presented.summaryLines)
    expect(summary.detailLines).toEqual([])
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

  it('静态 Transcript 的重复渲染不会重新处理工具结果', () => {
    const terminal = new MemoryTerminal()
    const tui = new TuiMainScreen(terminal, true)
    const store = new TuiStore([
      {
        type: 'tool/call',
        seq: 0,
        time: 0,
        data: { callId: 'cache-call', name: 'bash', arguments: '{"cmd":"pwd"}' },
      },
      {
        type: 'tool/result',
        seq: 1,
        time: 1,
        data: {
          message: {
            content: [{ type: 'tool-result', toolCallId: 'cache-call', content: [{ type: 'text', text: '/tmp' }] }],
          },
        },
      },
    ])
    const presenter = new ToolPresenter(undefined)
    const app = new App(tui, store, presenter, () => undefined)
    const renderToolCard = vi.spyOn(ToolCard.prototype, 'render')

    const first = app.render(48)
    const second = app.render(48)

    expect(renderToolCard).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    renderToolCard.mockRestore()
    app.dispose()
  })

  it('思考默认完整显示，并由全局开关隐藏和恢复', () => {
    const terminal = new MemoryTerminal()
    const tui = new TuiMainScreen(terminal, true)
    const store = new TuiStore([
      {
        type: 'assistant/message',
        seq: 0,
        time: 0,
        data: {
          turn: 1,
          step: 1,
          message: {
            content: [
              { type: 'reasoning', text: '第一步分析\n第二步验证\n第三步完成' },
              { type: 'text', text: '最终答案' },
            ],
          },
        },
      },
    ])
    const app = new App(tui, store, new ToolPresenter(undefined), () => undefined)

    const visible = app.render(48).map(stripTerminalSequences).join('\n')
    expect(visible).toContain('第一步分析')
    expect(visible).toContain('第三步完成')

    store.toggleReasoningVisibility()
    const hidden = app.render(48).map(stripTerminalSequences).join('\n')
    expect(hidden).not.toContain('第一步分析')
    expect(hidden).not.toContain('第三步完成')
    expect(hidden).toContain('最终答案')

    store.toggleReasoningVisibility()
    const restored = app.render(48).map(stripTerminalSequences).join('\n')
    expect(restored).toContain('第一步分析')
    expect(restored).toContain('第三步完成')
    assertWidth(app.render(48), 48)
    app.dispose()
  })

  it('运行时根据工具与流式内容更新活动文案，并显示 Esc 与计时', () => {
    vi.useFakeTimers()
    const terminal = new MemoryTerminal()
    const tui = new TuiMainScreen(terminal, true)
    const store = new TuiStore([
      {
        type: 'tool/call',
        seq: 0,
        time: 0,
        data: { callId: 'activity-call', name: 'read', arguments: '{"path":"docs/startup.md"}' },
      },
    ])
    store.setStatus('running')
    const presenter = new ToolPresenter({
      get: () => ({ presentCall: () => ({ card: 'generic', title: '查看开发文档启动细节', kind: 'read' }) }),
    })
    const app = new App(tui, store, presenter, () => undefined)
    try {
      const plain = app.render(64).map(stripTerminalSequences).join('\n')
      expect(plain).toContain('查看开发文档启动细节')
      expect(plain).toContain('⟨esc⟩')
      expect(plain).toContain('· 0s')
      expect(plain).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)

      vi.advanceTimersByTime(80)
      const nextFrame = app.render(64).map(stripTerminalSequences).join('\n')
      expect(nextFrame).not.toBe(plain)

      vi.advanceTimersByTime(1920)
      const elapsed = app.render(64).map(stripTerminalSequences).join('\n')
      expect(elapsed).toContain('· 2s')

      const waitingStore = new TuiStore()
      waitingStore.setStatus('running')
      expect(resolveWorkingActivity(waitingStore.getSnapshot(), new ToolPresenter(undefined))).toBe(
        '正在等待模型响应',
      )

      const thinkingStore = new TuiStore([
        {
          type: 'assistant/chunk',
          seq: 0,
          time: 0,
          data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '分析中' } },
        },
      ])
      thinkingStore.setStatus('running')
      expect(resolveWorkingActivity(thinkingStore.getSnapshot(), new ToolPresenter(undefined))).toBe('Thinking: 分析中')
      thinkingStore.appendEvent({
        type: 'assistant/chunk',
        seq: 1,
        time: 1,
        data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '，正在添加计时器' } },
      })
      expect(resolveWorkingActivity(thinkingStore.getSnapshot(), new ToolPresenter(undefined))).toBe(
        'Thinking: 分析中，正在添加计时器',
      )

      const replyingStore = new TuiStore([
        {
          type: 'assistant/chunk',
          seq: 0,
          time: 0,
          data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '正在整理最终结果' } },
        },
      ])
      replyingStore.setStatus('running')
      expect(resolveWorkingActivity(replyingStore.getSnapshot(), new ToolPresenter(undefined))).toBe(
        '正在整理最终结果',
      )

      const betweenStepsStore = new TuiStore([
        { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
        { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } },
        {
          type: 'assistant/message',
          seq: 2,
          time: 2,
          data: {
            turn: 1,
            step: 1,
            message: { content: [{ type: 'reasoning', text: '已完成第一步，接下来检查测试' }] },
          },
        },
        { type: 'step/end', seq: 3, time: 3, data: { turn: 1, step: 1 } },
        { type: 'step/start', seq: 4, time: 4, data: { turn: 1, step: 2 } },
      ])
      betweenStepsStore.setStatus('running')
      expect(resolveWorkingActivity(betweenStepsStore.getSnapshot(), new ToolPresenter(undefined))).toBe(
        'Thinking: 已完成第一步，接下来检查测试',
      )

      const intentStore = new TuiStore([
        {
          type: 'tool/call',
          seq: 0,
          time: 0,
          data: {
            callId: 'intent-call',
            name: 'read',
            arguments: '{"path":"src/tui","intent":"检查状态栏刷新逻辑"}',
          },
        },
      ])
      intentStore.setStatus('running')
      expect(resolveWorkingActivity(intentStore.getSnapshot(), presenter)).toBe('检查状态栏刷新逻辑')

      store.setStatus('idle')
      expect(app.render(64).map(stripTerminalSequences).join('\n')).not.toContain('⟨esc⟩')
    } finally {
      app.dispose()
      vi.useRealTimers()
    }
  })

  it('工作计时使用紧凑的时分秒格式', () => {
    expect(formatWorkingElapsed(-1)).toBe('0s')
    expect(formatWorkingElapsed(61_999)).toBe('1m 01s')
    expect(formatWorkingElapsed(3_661_000)).toBe('1h 01m 01s')
  })

  it('Tool Detail 滚动时复用已展开的内容', () => {
    const entry: ToolTranscriptEntry = {
      kind: 'tool',
      key: 'tool:detail-cache',
      seq: 4,
      callId: 'detail-cache',
      name: 'bash',
      arguments: '{"cmd":"long-output"}',
      result: Array.from({ length: 200 }, (_, index) => `line ${index + 1}`).join('\n'),
      resultMeta: undefined,
      status: 'success',
      startedAt: 10,
      durationMs: 20,
    }
    const presenter = new ToolPresenter(undefined)
    const dialog = new ToolDetailDialog([entry], 0, () => undefined)
    const present = vi.spyOn(presenter, 'present')

    dialog.render(48, presenter)
    dialog.handleInput(Key.pageDown)
    dialog.render(48, presenter)

    expect(present).toHaveBeenCalledTimes(1)
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
    expect(plain).toContain('检查当前项目')
    expect(plain).toContain('项目状态正常。')
    expect(plain).not.toContain('› You')
    expect(plain).not.toContain('● DeepSeek')
    expect(plain).toContain('╭')
    expect(plain).toContain('输入任务，/ 查看命令…')
    app.dispose()
  })

  it('请求失败会在主屏 Transcript 中明确显示', () => {
    const terminal = new MemoryTerminal()
    terminal.columns = 48
    const tui = new TuiMainScreen(terminal, true)
    const store = new TuiStore([
      {
        type: 'turn/end',
        seq: 0,
        time: 0,
        data: {
          turn: 1,
          reason: {
            kind: 'error',
            error: { code: 'QUOTA', message: 'Allocated quota exceeded.' },
          },
        },
      },
    ])
    const app = new App(tui, store, new ToolPresenter(undefined), () => undefined)
    tui.addChild(app)
    const plain = app.render(48).map(stripTerminalSequences).join('\n')
    expect(plain).toContain('请求失败')
    expect(plain).toContain('QUOTA')
    expect(plain).toContain('Allocated quota exceeded.')
    assertWidth(app.render(48), 48)
    app.dispose()
  })

  it('关闭时在最终文档中显示中文关闭状态', () => {
    const terminal = new MemoryTerminal()
    terminal.columns = 64
    const tui = new TuiMainScreen(terminal, true)
    const store = new TuiStore()
    store.beginClosing()
    const app = new App(tui, store, new ToolPresenter(undefined), () => undefined)
    tui.addChild(app)
    expect(app.render(64).map(stripTerminalSequences).join('\n')).toContain('正在关闭会话…')
    app.dispose()
  })

  it('Slash 补全菜单显示首屏命令且可滚动选择末项', async () => {
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
    expect(plain).toContain('model')
    expect(plain).toContain('sandbox')

    for (let index = 1; index < SLASH_COMMAND_AUTOCOMPLETE_ITEMS.length; index++) {
      app.prompt.input.handleInput('\u001b[B')
    }
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
