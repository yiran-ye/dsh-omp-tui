import { stripTerminalSequences, type Terminal } from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vitest'
import { mountTui } from '../src/tui/mount.js'
import { TuiStore } from '../src/tui/store.js'

class MemoryTerminal implements Terminal {
  kittyProtocolActive = false
  columns = 64
  rows = 24
  output = ''
  private onInput: ((data: string) => void) | undefined

  start(onInput: (data: string) => void, _onResize: () => void): void {
    this.onInput = onInput
  }
  input(data: string): void {
    this.onInput?.(data)
  }
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

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

describe('备用屏挂载', () => {
  it('进入干净的备用屏，并在停止时回写最终文档', () => {
    const terminal = new MemoryTerminal()
    const store = new TuiStore()
    const mounted = mountTui({
      store,
      terminal,
      requireTty: false,
      actions: {
        send: vi.fn<(text: string) => void>(),
        cancel: vi.fn<() => void>(),
        selectModel: async () => undefined,
        newSession: async () => undefined,
        shutdown: async () => undefined,
      },
    })

    mounted.tui.renderNow(true)
    expect(terminal.output).toContain('\u001b[?1049h')
    expect(stripTerminalSequences(terminal.output)).toContain('欢迎回来！')

    store.beginClosing()
    mounted.stop()
    expect(terminal.output).toContain('\u001b[?1049l')
    expect(stripTerminalSequences(terminal.output)).toContain('dsh-omp-tui v')
    expect(stripTerminalSequences(terminal.output)).toContain('正在关闭会话…')
  })

  it('显式主滚动容器保持向上滚动能力', () => {
    const terminal = new MemoryTerminal()
    terminal.rows = 8
    const store = new TuiStore([
      {
        type: 'user/message',
        seq: 0,
        time: 0,
        data: {
          content: [{ type: 'text', text: Array.from({ length: 80 }, (_, index) => `第 ${index + 1} 行`).join('\n') }],
          source: { kind: 'user' },
        },
      },
    ])
    const mounted = mountTui({
      store,
      terminal,
      requireTty: false,
      actions: {
        send: vi.fn<(text: string) => void>(),
        cancel: vi.fn<() => void>(),
        selectModel: async () => undefined,
        newSession: async () => undefined,
        shutdown: async () => undefined,
      },
    })

    mounted.tui.renderNow(true)
    expect(mounted.tui.isFollowingOutput).toBe(true)
    expect(stripTerminalSequences(terminal.output)).toContain('▐')
    const bottom = mounted.tui.viewportTop
    terminal.input('\u001b[<64;1;1M')
    mounted.tui.renderNow()

    expect(mounted.tui.viewportTop).toBe(bottom - 3)
    store.appendEvent({
      type: 'user/message',
      seq: 1,
      time: 1,
      data: { content: [{ type: 'text', text: '滚动期间的新输出' }], source: { kind: 'user' } },
    })
    expect(mounted.app.render(64).map(stripTerminalSequences).join('\n')).not.toContain('滚动期间的新输出')

    mounted.tui.scrollToBottom()
    mounted.tui.renderNow()

    expect(mounted.app.render(64).map(stripTerminalSequences).join('\n')).toContain('滚动期间的新输出')
    mounted.stop()
  })
})

describe('Slash Command 分派', () => {
  it('动态列出并执行 Harness 注册命令', async () => {
    const store = new TuiStore()
    const send = vi.fn<(text: string) => void>()
    const execute = vi.fn(async () => ({ result: { kind: 'success' as const, text: '目标已更新。' } }))
    const mounted = mountTui({
      store,
      terminal: new MemoryTerminal(),
      requireTty: false,
      actions: {
        send,
        cancel: vi.fn<() => void>(),
        selectModel: async () => undefined,
        newSession: async () => undefined,
        shutdown: async () => undefined,
      },
      commands: {
        list: () => [{ name: 'goal', description: '管理长任务目标', input: { hint: '<objective>' } }],
        execute,
      },
    })

    mounted.app.prompt.input.onSubmit?.('/goal 完成 Slash Commands')
    await settle()

    expect(execute).toHaveBeenCalledWith('/goal 完成 Slash Commands', expect.any(AbortSignal))
    expect(send).not.toHaveBeenCalled()
    expect(store.getSnapshot().notice).toBe('目标已更新。')

    mounted.app.prompt.input.handleInput('/')
    mounted.app.prompt.input.handleInput('g')
    await settle()
    const plain = mounted.app.render(64).map(stripTerminalSequences).join('\n')
    expect(plain).toContain('goal')
    expect(plain).toContain('管理长任务目标')
    mounted.stop()
  })

  it('未注册的 Slash 输入保持为普通 Agent 消息', async () => {
    const send = vi.fn<(text: string) => void>()
    const mounted = mountTui({
      store: new TuiStore(),
      terminal: new MemoryTerminal(),
      requireTty: false,
      actions: {
        send,
        cancel: vi.fn<() => void>(),
        selectModel: async () => undefined,
        newSession: async () => undefined,
        shutdown: async () => undefined,
      },
      commands: {
        list: () => [],
        execute: async () => undefined,
      },
    })

    mounted.app.prompt.input.onSubmit?.('/custom-skill')
    await settle()

    expect(send).toHaveBeenCalledWith('/custom-skill')
    mounted.stop()
  })

  it('动态补全 Skill，并通过 /skills 打开选择目录', async () => {
    const store = new TuiStore()
    const mounted = mountTui({
      store,
      terminal: new MemoryTerminal(),
      requireTty: false,
      actions: {
        send: vi.fn<(text: string) => void>(),
        cancel: vi.fn<() => void>(),
        selectModel: async () => undefined,
        newSession: async () => undefined,
        shutdown: async () => undefined,
      },
      skills: {
        list: async () => [{ name: 'release-notes', description: '生成发布说明' }],
      },
    })

    await settle()
    mounted.app.prompt.input.handleInput('/')
    mounted.app.prompt.input.handleInput('r')
    await settle()
    const plain = mounted.app.render(64).map(stripTerminalSequences).join('\n')
    expect(plain).toContain('release-notes')

    mounted.app.prompt.input.onSubmit?.('/skills')
    await settle()
    expect(store.getSnapshot().overlay).toMatchObject({ kind: 'catalog', title: '技能' })
    mounted.stop()
  })

  it('通过 /mcp 列出已注册的 MCP 工具', () => {
    const store = new TuiStore()
    const mounted = mountTui({
      store,
      terminal: new MemoryTerminal(),
      requireTty: false,
      actions: {
        send: vi.fn<(text: string) => void>(),
        cancel: vi.fn<() => void>(),
        selectModel: async () => undefined,
        newSession: async () => undefined,
        shutdown: async () => undefined,
      },
      mcp: {
        list: () => [{ name: 'mcp__github__create_issue', description: '创建 GitHub Issue' }],
      },
    })

    mounted.app.prompt.input.onSubmit?.('/mcp')
    expect(store.getSnapshot().overlay).toMatchObject({ kind: 'catalog', title: 'MCP 工具' })
    mounted.stop()
  })

  it('通过 /model 显示模型目录并提交选择', async () => {
    const store = new TuiStore()
    store.setSession('session-model', 'deepseek', 'deepseek-chat')
    const terminal = new MemoryTerminal()
    const selectModel = vi.fn(async (_provider: string, _model: string) => undefined)
    const mounted = mountTui({
      store,
      terminal,
      requireTty: false,
      actions: {
        send: vi.fn<(text: string) => void>(),
        cancel: vi.fn<() => void>(),
        selectModel,
        newSession: async () => undefined,
        shutdown: async () => undefined,
      },
      models: {
        list: async () => ({
          models: [
            {
              provider: 'openai',
              providerName: 'OpenAI',
              model: 'gpt-5.4',
              name: 'GPT-5.4',
              description: '适合复杂编码任务',
            },
            {
              provider: 'deepseek',
              providerName: 'DeepSeek',
              model: 'deepseek-chat',
              name: 'DeepSeek Chat',
            },
          ],
          failures: [],
        }),
      },
    })

    mounted.app.prompt.input.onSubmit?.('/model')
    await settle()
    const overlay = store.getSnapshot().overlay
    expect(overlay).toMatchObject({ kind: 'catalog', title: '模型' })
    if (overlay.kind !== 'catalog') throw new Error('expected model catalog')
    expect(overlay.body).toContain('当前模型：deepseek/deepseek-chat')

    terminal.input('\u001b[A')
    terminal.input('\r')
    await settle()
    expect(selectModel).toHaveBeenCalledWith('openai', 'gpt-5.4')
    mounted.stop()
  })
})
