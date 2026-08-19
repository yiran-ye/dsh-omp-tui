import { ProcessTerminal, TuiMainScreen, type OverlayHandle, type Terminal } from '@earendil-works/pi-tui'
import type { InteractionQueue } from '../runtime/interaction-queue.js'
import type { ToolLookup } from '../runtime/tool-presentation.js'
import { ToolPresenter } from '../runtime/tool-presentation.js'
import { TerminalRestore, assertInteractiveTerminal } from '../runtime/terminal-restore.js'
import type { TuiStore } from './store.js'
import { InputPolicy, parseSlashCommand } from './commands.js'
import { App } from './components/app.js'
import { ApprovalDialog } from './components/approval-dialog.js'
import { HelpDialog } from './components/help-dialog.js'
import { QuestionDialog } from './components/question-dialog.js'
import { BoundToolDetailDialog } from './components/tool-detail-dialog.js'

export interface TuiActions {
  send(text: string): void
  cancel(): void
  newSession(): Promise<void>
  shutdown(): Promise<void>
}

export interface MountOptions {
  readonly store: TuiStore
  readonly actions: TuiActions
  readonly tools?: ToolLookup
  readonly interactions?: InteractionQueue
  readonly maxToolLines?: number
  readonly terminal?: Terminal
  readonly requireTty?: boolean
}

export interface MountedTui {
  readonly tui: TuiMainScreen
  readonly app: App
  stop(): void
}

export function mountTui(options: MountOptions): MountedTui {
  if (options.requireTty !== false && options.terminal === undefined) assertInteractiveTerminal()
  const terminal = options.terminal ?? new ProcessTerminal()
  const tui = new TuiMainScreen(terminal, true)
  const presenter = new ToolPresenter(options.tools, options.maxToolLines ?? 8)
  const policy = new InputPolicy()
  let stopped = false
  const runAction = (action: Promise<void>, label: string): void => {
    void action.catch((error: unknown) => {
      options.store.setNotice(`${label}失败：${error instanceof Error ? error.message : String(error)}`)
    })
  }
  const submit = (text: string): void => {
    if (text.length === 0) return
    app.prompt.input.addToHistory(text)
    const command = parseSlashCommand(text)
    if (command === 'help') {
      options.store.setOverlay({ kind: 'help' })
    } else if (command === 'tools') {
      options.store.setOverlay({ kind: 'tools', selected: 0 })
    } else if (command === 'clear') {
      runAction(options.actions.newSession(), '/clear')
    } else if (command === 'exit' || command === 'quit') {
      runAction(options.actions.shutdown(), command === 'exit' ? '/exit' : '/quit')
    } else {
      options.actions.send(text)
    }
  }

  const app = new App(tui, options.store, presenter, submit)
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
    const token = interaction === undefined ? overlay.kind : `${interaction.kind}:${interaction.id}`
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
      overlayHandle = tui.showOverlay(new HelpDialog(), {
        width: '75%', minWidth: 36, maxHeight: '75%', anchor: 'center', margin: 1,
      })
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
    clearInput: () => app.prompt.input.setText(''),
    cancel: () => options.actions.cancel(),
    exit: () => {
      runAction(options.actions.shutdown(), '退出')
    },
    openTools: () => options.store.setOverlay({ kind: 'tools', selected: 0 }),
    closeOverlay: () => {
      const interaction = options.interactions?.getSnapshot().active
      if (interaction?.kind === 'approval') options.interactions?.answerApproval(interaction.id, 'cancelled')
      else if (interaction?.kind === 'question') options.interactions?.skipQuestion(interaction.id)
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
    stop() {
      if (stopped) return
      stopped = true
      removeInputListener()
      removeOverlayStoreListener()
      removeInteractionListener?.()
      closeRenderedOverlay()
      app.dispose()
      restore.restore()
    },
  }
}
