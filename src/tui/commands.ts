import { Key, matchesKey } from '@earendil-works/pi-tui'
import type { AgentStatus } from '@deepseek-ai/dsh-agent'

export type SlashCommand = 'help' | 'tools' | 'clear' | 'exit' | 'quit'

export function parseSlashCommand(text: string): SlashCommand | undefined {
  const normalized = text.trim().toLowerCase()
  if (!normalized.startsWith('/')) return undefined
  const command = normalized.slice(1).split(/\s+/, 1)[0]
  return command === 'help' || command === 'tools' || command === 'clear' || command === 'exit' || command === 'quit'
    ? command
    : undefined
}

export interface InputContext {
  readonly status: AgentStatus
  readonly input: string
  readonly overlayOpen: boolean
  clearInput(): void
  cancel(): void
  exit(): void
  openTools(): void
  closeOverlay(): void
  notice(message: string): void
}

export class InputPolicy {
  private lastExitKey: 'ctrl-c' | 'ctrl-d' | undefined
  private lastExitAt = 0

  constructor(private readonly now: () => number = Date.now, private readonly doublePressMs = 1_500) {}

  handle(data: string, context: InputContext): { consume: boolean } | undefined {
    if (matchesKey(data, Key.escape) && context.overlayOpen) {
      context.closeOverlay()
      this.reset()
      return { consume: true }
    }
    if (context.overlayOpen) return undefined
    if (matchesKey(data, Key.ctrl('o'))) {
      context.openTools()
      this.reset()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('c'))) {
      if (context.status === 'running') {
        context.cancel()
        this.reset()
      } else if (context.input.length > 0) {
        context.clearInput()
        this.reset()
      } else {
        this.armOrExit('ctrl-c', context)
      }
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('d')) && context.status === 'idle' && context.input.length === 0) {
      this.armOrExit('ctrl-d', context)
      return { consume: true }
    }
    this.reset()
    return undefined
  }

  private armOrExit(key: 'ctrl-c' | 'ctrl-d', context: InputContext): void {
    const current = this.now()
    if (this.lastExitKey === key && current - this.lastExitAt <= this.doublePressMs) {
      this.reset()
      context.exit()
      return
    }
    this.lastExitKey = key
    this.lastExitAt = current
    context.notice(`再次按 ${key === 'ctrl-c' ? 'Ctrl+C' : 'Ctrl+D'} 退出`)
  }

  private reset(): void {
    this.lastExitKey = undefined
    this.lastExitAt = 0
  }
}

export const HELP_TEXT = [
  '/help   显示命令和快捷键',
  '/tools  打开工具详情浏览器',
  '/clear  创建新 Session（保留输入历史）',
  '/exit   优雅退出',
  '/quit   优雅退出',
  '',
  'Enter 提交 · Shift/Alt+Enter 换行 · Ctrl+C 取消/双击退出',
  'Ctrl+D 双击退出 · Ctrl+O 工具详情 · Esc 关闭 Overlay · ↑/↓ 历史',
].join('\n')
