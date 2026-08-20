import { isKeyRelease, Key, matchesKey, type SlashCommand as AutocompleteSlashCommand } from '@earendil-works/pi-tui'
import type { AgentStatus } from '@deepseek-ai/dsh-agent'

export interface RegisteredSlashCommand {
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint: string }
}

export interface RegisteredSlashCommandExecution {
  readonly result: {
    readonly kind: 'success' | 'error'
    readonly text?: string
  }
}

export interface SlashCommandRegistry {
  list(): readonly RegisteredSlashCommand[]
  execute(line: string, signal: AbortSignal): Promise<RegisteredSlashCommandExecution | undefined>
}

export interface UserInvocableSkill {
  readonly name: string
  readonly description?: string
  readonly whenToUse?: string
}

export interface SkillRegistry {
  list(signal: AbortSignal): Promise<readonly UserInvocableSkill[]>
}

export interface McpTool {
  readonly name: string
  readonly description?: string
}

export interface McpToolRegistry {
  list(): readonly McpTool[]
}

const SANDBOX_MODE_AUTOCOMPLETE_ITEMS = [
  { value: 'read-only', label: 'read-only', description: 'Read Only' },
  { value: 'workspace-write', label: 'workspace-write', description: 'Write' },
  { value: 'danger-full-access', label: 'danger-full-access', description: 'Full Access' },
] as const

export const SLASH_COMMAND_AUTOCOMPLETE_ITEMS = [
  { name: 'help', description: '显示命令和快捷键' },
  { name: 'tools', description: '打开工具详情浏览器' },
  { name: 'skills', description: '浏览并选择可由用户调用的技能' },
  { name: 'mcp', description: '浏览已连接的 MCP 工具' },
  { name: 'model', description: '显示并切换当前 Agent 的模型与思考等级' },
  {
    name: 'sandbox',
    description: '显示并切换当前 Session 的 Sandbox Mode',
    argumentHint: '[mode]',
    getArgumentCompletions: (prefix: string) => {
      const normalized = prefix.trim().toLowerCase()
      return SANDBOX_MODE_AUTOCOMPLETE_ITEMS.filter((item) => item.value.startsWith(normalized))
    },
  },
  { name: 'resume', description: '恢复最近会话', argumentHint: '[session-id]' },
  { name: 'clear', description: '创建新会话（保留输入历史）' },
  { name: 'new', description: '创建新会话（/clear 的别名）' },
  { name: 'retry', description: '重新发送上一条用户任务' },
  { name: 'hotkeys', description: '显示命令和快捷键（/help 的别名）' },
  { name: 'exit', description: '优雅退出' },
  { name: 'quit', description: '优雅退出' },
] as const satisfies readonly AutocompleteSlashCommand[]

export type SlashCommand = (typeof SLASH_COMMAND_AUTOCOMPLETE_ITEMS)[number]['name']

export function parseSlashCommand(text: string): SlashCommand | undefined {
  const normalized = text.trim().toLowerCase()
  if (!normalized.startsWith('/')) return undefined
  const command = normalized.slice(1).split(/\s+/, 1)[0]
  return SLASH_COMMAND_AUTOCOMPLETE_ITEMS.find((item) => item.name === command)?.name
}

export function mergeSlashCommandAutocompleteItems(
  registered: readonly RegisteredSlashCommand[],
  skills: readonly UserInvocableSkill[] = [],
): readonly AutocompleteSlashCommand[] {
  const local = new Map<string, AutocompleteSlashCommand>(
    SLASH_COMMAND_AUTOCOMPLETE_ITEMS.map((item) => [item.name, item]),
  )
  const items: AutocompleteSlashCommand[] = []
  const names = new Set<string>()
  for (const command of registered) {
    if (names.has(command.name)) continue
    items.push(local.get(command.name) ?? {
      name: command.name,
      description: command.description,
      ...(command.input === undefined ? {} : { argumentHint: command.input.hint }),
    })
    names.add(command.name)
  }
  for (const command of SLASH_COMMAND_AUTOCOMPLETE_ITEMS) {
    if (names.has(command.name)) continue
    items.push(command)
    names.add(command.name)
  }
  for (const skill of skills) {
    const name = skill.name.trim()
    if (name.length === 0 || /[\s/]/.test(name) || names.has(name)) continue
    items.push({
      name,
      description: skill.description ?? skill.whenToUse ?? '技能',
    })
    names.add(name)
  }
  return items
}

export function formatHelpText(commands: readonly AutocompleteSlashCommand[]): string {
  return [
    ...commands.map((command) => {
      const input = command.argumentHint === undefined ? '' : ` ${command.argumentHint}`
      return `/${command.name}${input}  ${command.description ?? ''}`.trimEnd()
    }),
    '',
    'Enter 提交 · Shift/Alt+Enter 换行 · Shift+Tab 切换 Normal/Plan',
    'Ctrl+T 切换思考过程 · Ctrl+R 切换思考等级',
    'Ctrl+C/Ctrl+D 双击退出 · Ctrl+O 工具详情 · Esc 关闭弹窗/取消命令/取消运行 · ↑/↓ 历史',
  ].join('\n')
}

export interface InputContext {
  readonly status: AgentStatus
  readonly input: string
  readonly overlayOpen: boolean
  readonly commandRunning: boolean
  clearInput(): void
  cancel(): void
  cancelCommand(): void
  toggleReasoning(): boolean
  cycleReasoningEffort(): void
  toggleCollaborationMode(): void
  exit(): void
  openTools(): void
  closeOverlay(): void
}

export class InputPolicy {
  private lastExitKey: 'ctrl-c' | 'ctrl-d' | undefined
  private lastExitAt = 0

  constructor(private readonly now: () => number = Date.now, private readonly doublePressMs = 1_500) {}

  handle(data: string, context: InputContext): { consume: boolean } | undefined {
    // Kitty keyboard protocol emits both press and release events. The release
    // has the same modifiers, so handling it would invoke global shortcuts twice.
    if (isKeyRelease(data)) return { consume: true }
    if (matchesKey(data, Key.escape) && context.overlayOpen) {
      context.closeOverlay()
      this.reset()
      return { consume: true }
    }
    if (context.overlayOpen) return undefined
    if (matchesKey(data, Key.shift(Key.tab))) {
      context.toggleCollaborationMode()
      this.reset()
      return { consume: true }
    }
    if (matchesKey(data, Key.escape) && context.commandRunning) {
      context.cancelCommand()
      this.reset()
      return { consume: true }
    }
    if (matchesKey(data, Key.escape) && context.status === 'running') {
      context.cancel()
      this.reset()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('t'))) {
      context.toggleReasoning()
      this.reset()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('r'))) {
      context.cycleReasoningEffort()
      this.reset()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('o'))) {
      context.openTools()
      this.reset()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('c'))) {
      if (context.commandRunning) {
        context.cancelCommand()
        this.reset()
      } else if (context.status === 'running') {
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
  }

  private reset(): void {
    this.lastExitKey = undefined
    this.lastExitAt = 0
  }
}

export const HELP_TEXT = formatHelpText(SLASH_COMMAND_AUTOCOMPLETE_ITEMS)
