import { stripTerminalSequences, type Terminal } from '@earendil-works/pi-tui'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { mountTui } from '../src/tui/mount.js'
import type { SandboxMode } from '../src/tui/state.js'
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

  it('输入重绘不会向 Orca 终端宿主发送 BEL', () => {
    const terminal = new MemoryTerminal()
    const mounted = mountTui({
      store: new TuiStore(),
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
    terminal.output = ''
    terminal.input('x')
    mounted.tui.renderNow()

    expect(terminal.output).not.toContain('\u0007')
    expect(terminal.output).toContain('\u001b]8;;\u001b\\')
    mounted.stop()
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

  it('将 Ctrl+T 和 Esc 分派为思考切换与运行取消', () => {
    const terminal = new MemoryTerminal()
    const store = new TuiStore()
    const cancel = vi.fn<() => void>()
    store.setStatus('running')
    const mounted = mountTui({
      store,
      terminal,
      requireTty: false,
      actions: {
        send: vi.fn<(text: string) => void>(),
        cancel,
        selectModel: async () => undefined,
        newSession: async () => undefined,
        shutdown: async () => undefined,
      },
    })

    terminal.input('\u001b[116;5u')
    terminal.input('\u001b[116;5:3u')
    expect(store.getSnapshot().reasoningVisible).toBe(false)
    expect(store.getSnapshot().notice).toBeUndefined()
    terminal.input('\u001b')
    expect(cancel).toHaveBeenCalledOnce()
    store.setStatus('idle')
    terminal.input('\u0003')
    expect(store.getSnapshot().notice).toBeUndefined()
    mounted.stop()
  })

  it('通过 Ctrl+R 循环当前模型公布的思考等级', async () => {
    const terminal = new MemoryTerminal()
    const store = new TuiStore()
    store.setSession('session-effort', 'openai', 'gpt-5.6-luna')
    store.setStatusLine({ reasoningEffort: 'high', compactionAvailable: false })
    const selectModel = vi.fn(async (_selection: ModelSelection) => undefined)
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
        list: async () => ({ models: [], failures: [] }),
        resolveReasoning: async () => ({
          efforts: [
            { id: ReasoningEffortId('low'), name: 'low' },
            { id: ReasoningEffortId('high'), name: 'high' },
            { id: ReasoningEffortId('max'), name: 'max' },
          ],
          defaultEffort: ReasoningEffortId('high'),
        }),
      },
    })

    terminal.input('\u0012')
    await settle()

    expect(selectModel).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'max',
    })
    expect(store.getSnapshot().notice).toBe('思考等级已切换为 max。')
    mounted.stop()
  })

  it('用户下一次按键会立即清除通知', () => {
    const terminal = new MemoryTerminal()
    const store = new TuiStore()
    store.setNotice('未检测到 MCP 工具。')
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

    terminal.input('\u001b[120;1:3u')
    expect(store.getSnapshot().notice).toBe('未检测到 MCP 工具。')
    terminal.input('x')

    expect(store.getSnapshot().notice).toBeUndefined()
    mounted.stop()
  })
})

describe('Slash Command 分派', () => {
  it('通过 Shift+Tab 在 Normal 与 Plan 之间切换', async () => {
    const terminal = new MemoryTerminal()
    const store = new TuiStore()
    let seq = 0
    const execute = vi.fn(async (line: string) => {
      store.appendEvent({
        type: 'plan/mode',
        seq: seq++,
        time: seq,
        data: { active: line !== '/plan off' },
      })
      return { result: { kind: 'success' as const } }
    })
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
      commands: {
        list: () => [{ name: 'plan', description: 'Enter or leave plan mode' }],
        execute,
      },
    })

    terminal.input('\u001b[Z')
    await settle()
    expect(execute).toHaveBeenLastCalledWith('/plan', expect.any(AbortSignal))
    expect(store.getSnapshot().harness.collaborationMode).toBe('plan')

    terminal.input('\u001b[Z')
    await settle()
    expect(execute).toHaveBeenLastCalledWith('/plan off', expect.any(AbortSignal))
    expect(store.getSnapshot().harness.collaborationMode).toBe('normal')
    mounted.stop()
  })

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

  it('通过 /sandbox 选择或直接切换当前 Session 的 Sandbox Mode', async () => {
    const store = new TuiStore()
    store.setSession('session-sandbox', 'openai', 'gpt-5.6-luna')
    store.setStatusLine({ sandboxMode: 'workspace-write', compactionAvailable: false })
    const terminal = new MemoryTerminal()
    const selectSandboxMode = vi.fn(async (mode: SandboxMode) => {
      store.setStatusLine({ ...store.getSnapshot().statusLine, sandboxMode: mode })
    })
    const mounted = mountTui({
      store,
      terminal,
      requireTty: false,
      actions: {
        send: vi.fn<(text: string) => void>(),
        cancel: vi.fn<() => void>(),
        selectModel: async () => undefined,
        selectSandboxMode,
        newSession: async () => undefined,
        shutdown: async () => undefined,
      },
    })

    mounted.app.prompt.input.onSubmit?.('/sandbox workspace-write')
    expect(selectSandboxMode).not.toHaveBeenCalled()
    expect(store.getSnapshot().notice).toBe('当前 Sandbox Mode 已是 Write。')

    mounted.app.prompt.input.onSubmit?.('/sandbox')
    const overlay = store.getSnapshot().overlay
    expect(overlay).toMatchObject({ kind: 'catalog', title: 'Sandbox Mode', selected: 1 })
    if (overlay.kind !== 'catalog') throw new Error('expected sandbox catalog')
    expect(overlay.items.map((item) => item.label)).toEqual([
      'Read Only · read-only',
      '✓ Write · workspace-write',
      'Full Access · danger-full-access',
    ])

    terminal.input('\u001b[B')
    terminal.input('\r')
    await settle()
    expect(selectSandboxMode).toHaveBeenLastCalledWith('danger-full-access')
    expect(store.getSnapshot().notice).toBe('Sandbox Mode 已切换为 Full Access。')

    mounted.app.prompt.input.onSubmit?.('/sandbox read-only')
    await settle()
    expect(selectSandboxMode).toHaveBeenLastCalledWith('read-only')

    mounted.app.prompt.input.onSubmit?.('/sandbox unrestricted')
    expect(store.getSnapshot().notice).toBe('用法：/sandbox [read-only|workspace-write|danger-full-access]')
    mounted.stop()
  })

  it('通过 /model 依次选择模型与该模型公布的思考等级', async () => {
    const store = new TuiStore()
    store.setSession('session-model', 'deepseek', 'deepseek-chat')
    const terminal = new MemoryTerminal()
    const selectModel = vi.fn(async (_selection: ModelSelection) => undefined)
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
        resolveReasoning: async (provider, model) => provider === 'openai' && model === 'gpt-5.4'
          ? {
              efforts: [
                { id: ReasoningEffortId('low'), name: 'low' },
                { id: ReasoningEffortId('high'), name: 'high' },
              ],
            }
          : undefined,
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
    const effortOverlay = store.getSnapshot().overlay
    expect(effortOverlay).toMatchObject({ kind: 'catalog', title: '思考等级' })
    if (effortOverlay.kind !== 'catalog') throw new Error('expected reasoning catalog')
    expect(effortOverlay.body).toContain('GPT-5.4（openai/gpt-5.4）')
    expect(effortOverlay.items.map((item) => item.label)).toEqual(['✓ Default', 'low', 'high'])

    terminal.input('\u001b[B')
    terminal.input('\u001b[B')
    terminal.input('\r')
    await settle()
    expect(selectModel).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    })
    mounted.stop()
  })
})
