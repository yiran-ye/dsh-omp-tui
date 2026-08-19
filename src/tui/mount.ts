import { ProcessTerminal, TuiMainScreen, type OverlayHandle, type Terminal } from '@earendil-works/pi-tui'
import type { InteractionQueue } from '../runtime/interaction-queue.js'
import type { ModelCatalogItem, ModelCatalogPort } from '../runtime/model-catalog.js'
import type { ToolLookup } from '../runtime/tool-presentation.js'
import { ToolPresenter } from '../runtime/tool-presentation.js'
import { TerminalRestore, assertInteractiveTerminal } from '../runtime/terminal-restore.js'
import type { TuiStore } from './store.js'
import {
  formatHelpText,
  InputPolicy,
  mergeSlashCommandAutocompleteItems,
  parseSlashCommand,
  type McpTool,
  type McpToolRegistry,
  type SlashCommandRegistry,
  type SkillRegistry,
  type UserInvocableSkill,
} from './commands.js'
import { App } from './components/app.js'
import { ApprovalDialog } from './components/approval-dialog.js'
import { CatalogDialog } from './components/catalog-dialog.js'
import { HelpDialog } from './components/help-dialog.js'
import { QuestionDialog } from './components/question-dialog.js'
import { BoundToolDetailDialog } from './components/tool-detail-dialog.js'
import type { CatalogOverlayItem } from './state.js'

export interface TuiActions {
  send(text: string): void
  cancel(): void
  selectModel(provider: string, model: string): Promise<void>
  newSession(): Promise<void>
  shutdown(): Promise<void>
}

export interface MountOptions {
  readonly store: TuiStore
  readonly actions: TuiActions
  readonly tools?: ToolLookup
  readonly interactions?: InteractionQueue
  readonly commands?: SlashCommandRegistry
  readonly skills?: SkillRegistry
  readonly mcp?: McpToolRegistry
  readonly models?: ModelCatalogPort
  readonly maxToolLines?: number
  readonly terminal?: Terminal
  readonly requireTty?: boolean
}

export interface MountedTui {
  readonly tui: TuiMainScreen
  readonly app: App
  refreshSlashCommands(): void
  stop(): void
}

export function mountTui(options: MountOptions): MountedTui {
  if (options.requireTty !== false && options.terminal === undefined) assertInteractiveTerminal()
  const terminal = options.terminal ?? new ProcessTerminal()
  const tui = new TuiMainScreen(terminal, true)
  const presenter = new ToolPresenter(options.tools, options.maxToolLines ?? 8)
  const policy = new InputPolicy()
  let stopped = false
  let activeSlashCommand: AbortController | undefined
  let activeSkillAutocomplete: AbortController | undefined
  let activeSkillPicker: AbortController | undefined
  let activeModelPicker: AbortController | undefined
  let catalogSelection: ((value: string) => void) | undefined
  let catalogId = 0
  let slashCommandsRevision = 0
  let userInvocableSkills: readonly UserInvocableSkill[] = []
  const resolveSlashCommands = () => {
    try {
      return mergeSlashCommandAutocompleteItems(options.commands?.list() ?? [], userInvocableSkills)
    } catch (error) {
      options.store.setNotice(`读取 Slash Commands 失败：${error instanceof Error ? error.message : String(error)}`)
      return mergeSlashCommandAutocompleteItems([], userInvocableSkills)
    }
  }
  let slashCommands = resolveSlashCommands()
  const updateSlashCommands = (): void => {
    slashCommands = resolveSlashCommands()
    slashCommandsRevision += 1
    app.prompt.setSlashCommands(slashCommands)
  }
  const refreshSkillAutocomplete = (): void => {
    activeSkillAutocomplete?.abort()
    const registry = options.skills
    if (registry === undefined) {
      userInvocableSkills = []
      updateSlashCommands()
      return
    }
    const controller = new AbortController()
    activeSkillAutocomplete = controller
    void registry.list(controller.signal)
      .then((skills) => {
        if (stopped || controller.signal.aborted || activeSkillAutocomplete !== controller) return
        userInvocableSkills = skills
        updateSlashCommands()
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !stopped) {
          options.store.setNotice(`读取 Skills 失败：${error instanceof Error ? error.message : String(error)}`)
        }
      })
      .finally(() => {
        if (activeSkillAutocomplete === controller) activeSkillAutocomplete = undefined
      })
  }
  const refreshSlashCommands = (): void => {
    updateSlashCommands()
    refreshSkillAutocomplete()
  }
  const runAction = (action: Promise<void>, label: string, onSuccess?: () => void): void => {
    void action.then(onSuccess).catch((error: unknown) => {
      options.store.setNotice(`${label}失败：${error instanceof Error ? error.message : String(error)}`)
    })
  }
  const closeCatalog = (): void => {
    catalogSelection = undefined
    options.store.setOverlay({ kind: 'none' })
  }
  const selectCatalog = (value: string): void => {
    const onSelect = catalogSelection
    catalogSelection = undefined
    options.store.setOverlay({ kind: 'none' })
    onSelect?.(value)
  }
  const openCatalog = (
    title: string,
    body: string,
    items: readonly CatalogOverlayItem[],
    onSelect: (value: string) => void,
    selected = 0,
  ): void => {
    catalogSelection = onSelect
    catalogId += 1
    options.store.setNotice(undefined)
    options.store.setOverlay({
      kind: 'catalog',
      id: catalogId,
      title,
      body,
      items,
      ...(selected === 0 ? {} : { selected }),
    })
  }
  const openSkills = (): void => {
    const registry = options.skills
    if (registry === undefined) {
      options.store.setNotice('Skills 服务未挂载。')
      return
    }
    activeSkillPicker?.abort()
    const controller = new AbortController()
    activeSkillPicker = controller
    options.store.setNotice('正在读取可由用户调用的 Skills…')
    void registry.list(controller.signal)
      .then((skills) => {
        if (stopped || controller.signal.aborted || activeSkillPicker !== controller) return
        userInvocableSkills = skills
        updateSlashCommands()
        if (skills.length === 0) {
          options.store.setNotice('当前工作区没有可由用户调用的 Skill。')
          return
        }
        openCatalog(
          'Skills',
          '选择后会在输入框预填 /名称；按 Enter 调用该 Skill。',
          skills.map((skill) => {
            const description = skill.description ?? skill.whenToUse
            return {
              value: skill.name,
              label: skill.name,
              ...(description === undefined ? {} : { description }),
            }
          }),
          (name) => {
            app.prompt.input.setText(`/${name} `)
            tui.setFocus(app.prompt.input)
            tui.requestRender()
          },
        )
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !stopped) {
          options.store.setNotice(`读取 Skills 失败：${error instanceof Error ? error.message : String(error)}`)
        }
      })
      .finally(() => {
        if (activeSkillPicker === controller) activeSkillPicker = undefined
      })
  }
  const openMcpTools = (): void => {
    let tools: readonly McpTool[]
    try {
      tools = options.mcp?.list() ?? []
    } catch (error) {
      options.store.setNotice(`读取 MCP 工具失败：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    if (tools.length === 0) {
      options.store.setNotice('未检测到 MCP 工具。请确认 @deepseek-ai/dsh-mcp-client 已连接并发现工具。')
      return
    }
    openCatalog(
      'MCP Tools',
      'MCP 工具由模型调用；选择后会把工具名预填到输入框，不会直接执行。',
      tools.map((tool) => ({
        value: tool.name,
        label: tool.name,
        ...(tool.description === undefined ? {} : { description: tool.description }),
      })),
      (name) => {
        app.prompt.input.setText(`请使用 MCP 工具 ${name}：`)
        tui.setFocus(app.prompt.input)
        tui.requestRender()
      },
    )
  }
  const openModels = (): void => {
    const registry = options.models
    if (registry === undefined) {
      options.store.setNotice('模型目录服务未挂载。')
      return
    }
    activeModelPicker?.abort()
    const controller = new AbortController()
    activeModelPicker = controller
    options.store.setNotice('正在读取可切换的模型…')
    void registry.list(controller.signal)
      .then((catalog) => {
        if (stopped || controller.signal.aborted || activeModelPicker !== controller) return
        if (catalog.models.length === 0) {
          const failures = catalog.failures.length === 0 ? '' : `：${catalog.failures.join('；')}`
          options.store.setNotice(`未检测到可切换模型${failures}`)
          return
        }
        const snapshot = options.store.getSnapshot()
        const current = [snapshot.provider, snapshot.model].filter(Boolean).join('/') || '未知'
        const modelsByValue = new Map<string, ModelCatalogItem>()
        let selectedIndex = 0
        const items = catalog.models.map((candidate, index) => {
          const value = String(index)
          modelsByValue.set(value, candidate)
          const active = candidate.provider === snapshot.provider && candidate.model === snapshot.model
          if (active) selectedIndex = index
          const label = candidate.name === candidate.model
            ? candidate.model
            : `${candidate.name} · ${candidate.model}`
          return {
            value,
            label: `${active ? '✓ ' : ''}${label}`,
            ...(candidate.description === undefined
              ? { description: candidate.providerName }
              : { description: `${candidate.providerName} · ${candidate.description}` }),
          }
        })
        const failures = catalog.failures.length === 0 ? '' : `\n\n未能读取：${catalog.failures.join('；')}`
        openCatalog(
          'Models',
          `当前模型：${current}\n选择后会在下一次模型请求生效。${failures}`,
          items,
          (value) => {
            const selectedModel = modelsByValue.get(value)
            if (selectedModel === undefined) {
              options.store.setNotice('模型目录已更新，请重新打开 /model。')
              return
            }
            runAction(options.actions.selectModel(selectedModel.provider, selectedModel.model), '切换模型')
          },
          selectedIndex,
        )
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !stopped) {
          options.store.setNotice(`读取模型目录失败：${error instanceof Error ? error.message : String(error)}`)
        }
      })
      .finally(() => {
        if (activeModelPicker === controller) activeModelPicker = undefined
      })
  }
  const retryLastPrompt = (): void => {
    if (options.store.getSnapshot().status === 'running') {
      options.store.setNotice('当前任务仍在运行；请先取消后再重试。')
      return
    }
    const transcript = options.store.getSnapshot().transcript
    for (let index = transcript.length - 1; index >= 0; index--) {
      const entry = transcript[index]
      if (entry?.kind !== 'user' || entry.injected) continue
      options.actions.send(entry.text)
      options.store.setNotice('已重新发送上一条用户任务。')
      return
    }
    options.store.setNotice('没有可重试的用户任务。')
  }
  const dispatchRegisteredCommand = (text: string): void => {
    const registry = options.commands
    if (registry === undefined) {
      options.actions.send(text)
      return
    }
    if (activeSlashCommand !== undefined) {
      options.store.setNotice('已有 Slash Command 正在执行；按 Esc 或 Ctrl+C 取消。')
      return
    }
    const controller = new AbortController()
    activeSlashCommand = controller
    options.store.setNotice(`正在执行 ${text}`)
    void registry.execute(text, controller.signal)
      .then((execution) => {
        if (execution === undefined) {
          options.actions.send(text)
          return
        }
        const result = execution.result
        options.store.setNotice(result.text ?? (result.kind === 'success' ? `${text} 已执行。` : `${text} 执行失败。`))
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          options.store.setNotice(`${text} 已取消。`)
          return
        }
        options.store.setNotice(`${text}失败：${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => {
        if (activeSlashCommand === controller) activeSlashCommand = undefined
      })
  }
  const submit = (text: string): void => {
    if (text.length === 0) return
    app.prompt.input.addToHistory(text)
    const command = parseSlashCommand(text)
    if (command === 'help' || command === 'hotkeys') {
      options.store.setOverlay({ kind: 'help' })
    } else if (command === 'tools') {
      options.store.setOverlay({ kind: 'tools', selected: 0 })
    } else if (command === 'skills') {
      openSkills()
    } else if (command === 'mcp') {
      openMcpTools()
    } else if (command === 'model') {
      openModels()
    } else if (command === 'clear' || command === 'new') {
      runAction(options.actions.newSession(), command === 'clear' ? '/clear' : '/new', refreshSlashCommands)
    } else if (command === 'retry') {
      retryLastPrompt()
    } else if (command === 'exit' || command === 'quit') {
      runAction(options.actions.shutdown(), command === 'exit' ? '/exit' : '/quit')
    } else if (text.trimStart().startsWith('/')) {
      dispatchRegisteredCommand(text)
    } else {
      options.actions.send(text)
    }
  }

  const app = new App(tui, options.store, presenter, submit)
  refreshSlashCommands()
  tui.addChild(app)
  const restore = new TerminalRestore(() => tui.stop())
  let overlayHandle: OverlayHandle | undefined
  let overlayToken = ''

  const closeRenderedOverlay = (): void => {
    overlayHandle?.hide()
    overlayHandle = undefined
    overlayToken = ''
  }

  const syncOverlay = (): void => {
    const interaction = options.interactions?.getSnapshot().active
    const overlay = options.store.getSnapshot().overlay
    const token = interaction === undefined
      ? overlay.kind === 'catalog'
        ? `catalog:${overlay.id}`
        : overlay.kind === 'help'
          ? `help:${slashCommandsRevision}`
          : overlay.kind
      : `${interaction.kind}:${interaction.id}`
    if (token === overlayToken) return
    closeRenderedOverlay()
    if (interaction?.kind === 'approval') {
      overlayToken = token
      overlayHandle = tui.showOverlay(
        new ApprovalDialog(interaction, (outcome) => options.interactions?.answerApproval(interaction.id, outcome)),
        { width: '70%', minWidth: 34, maxHeight: '70%', anchor: 'center', margin: 1 },
      )
    } else if (interaction?.kind === 'question') {
      overlayToken = token
      overlayHandle = tui.showOverlay(
        new QuestionDialog(tui, interaction, (answer) => options.interactions?.answerQuestion(interaction.id, answer)),
        { width: '80%', minWidth: 36, maxHeight: '85%', anchor: 'center', margin: 1 },
      )
    } else if (overlay.kind === 'help') {
      overlayToken = token
      overlayHandle = tui.showOverlay(new HelpDialog(formatHelpText(slashCommands)), {
        width: '75%', minWidth: 36, maxHeight: '75%', anchor: 'center', margin: 1,
      })
    } else if (overlay.kind === 'catalog') {
      overlayToken = token
      overlayHandle = tui.showOverlay(
        new CatalogDialog(overlay.title, overlay.body, overlay.items, selectCatalog, closeCatalog, overlay.selected),
        { width: '75%', minWidth: 36, maxHeight: '75%', anchor: 'center', margin: 1 },
      )
    } else if (overlay.kind === 'tools' || overlay.kind === 'tool-detail') {
      const tools = options.store.getSnapshot().transcript.filter((entry) => entry.kind === 'tool')
      const selected = overlay.kind === 'tools'
        ? overlay.selected
        : Math.max(0, tools.findIndex((entry) => entry.callId === overlay.callId))
      overlayToken = token
      overlayHandle = tui.showOverlay(
        new BoundToolDetailDialog(tools, selected, presenter, () => options.store.setOverlay({ kind: 'none' })),
        { width: '90%', minWidth: 40, maxHeight: '90%', anchor: 'center', margin: 1 },
      )
    }
  }

  const removeOverlayStoreListener = options.store.subscribe(syncOverlay)
  const removeInteractionListener = options.interactions?.subscribe(syncOverlay)
  const removeInputListener = tui.addInputListener((data) => policy.handle(data, {
    status: options.store.getSnapshot().status,
    input: app.prompt.input.getText(),
    overlayOpen: options.store.getSnapshot().overlay.kind !== 'none'
      || options.interactions?.getSnapshot().active !== undefined,
    commandRunning: activeSlashCommand !== undefined,
    clearInput: () => app.prompt.input.setText(''),
    cancel: () => options.actions.cancel(),
    cancelCommand: () => activeSlashCommand?.abort(),
    exit: () => {
      runAction(options.actions.shutdown(), '退出')
    },
    openTools: () => options.store.setOverlay({ kind: 'tools', selected: 0 }),
    closeOverlay: () => {
      const interaction = options.interactions?.getSnapshot().active
      if (interaction?.kind === 'approval') options.interactions?.answerApproval(interaction.id, 'cancelled')
      else if (interaction?.kind === 'question') options.interactions?.skipQuestion(interaction.id)
      else if (options.store.getSnapshot().overlay.kind === 'catalog') closeCatalog()
      else options.store.setOverlay({ kind: 'none' })
    },
    notice: (message) => options.store.setNotice(message),
  }))
  tui.start()
  tui.setFocus(app.prompt.input)
  syncOverlay()

  return {
    tui,
    app,
    refreshSlashCommands,
    stop() {
      if (stopped) return
      stopped = true
      activeSlashCommand?.abort()
      activeSkillAutocomplete?.abort()
      activeSkillPicker?.abort()
      activeModelPicker?.abort()
      removeInputListener()
      removeOverlayStoreListener()
      removeInteractionListener?.()
      closeRenderedOverlay()
      app.dispose()
      restore.restore()
    },
  }
}
