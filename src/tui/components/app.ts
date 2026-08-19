import { Container, type TUI } from '@earendil-works/pi-tui'
import type { ToolPresenter } from '../../runtime/tool-presentation.js'
import type { TuiStore } from '../store.js'
import type { TuiSnapshot } from '../state.js'
import { theme } from '../theme.js'
import { wrapPlain } from './common.js'
import { PromptEditor } from './prompt-editor.js'
import { StatusLine } from './status-line.js'
import { Transcript } from './transcript.js'
import { Welcome } from './welcome.js'

interface CachedBody {
  readonly snapshot: TuiSnapshot
  readonly width: number
  readonly lines: string[]
}

interface CachedRender {
  readonly body: readonly string[]
  readonly prompt: readonly string[]
  readonly lines: string[]
}

export class App extends Container {
  readonly prompt: PromptEditor
  private snapshot: TuiSnapshot
  private readonly transcript: Transcript
  private bodyCache: CachedBody | undefined
  private renderCache: CachedRender | undefined
  private followingOutput = true
  private pendingSnapshot: TuiSnapshot | undefined
  private readonly unsubscribe: () => void

  constructor(
    private readonly tui: TUI,
    store: TuiStore,
    tools: ToolPresenter,
    onSubmit: (text: string) => void,
  ) {
    super()
    this.snapshot = store.getSnapshot()
    this.transcript = new Transcript(this.snapshot, tools)
    this.prompt = new PromptEditor(tui, onSubmit)
    this.addChild(this.prompt)
    this.unsubscribe = store.subscribe((snapshot) => {
      if (!this.followingOutput && snapshot.lifecycle !== 'closing' && snapshot.sessionId === this.snapshot.sessionId) {
        this.pendingSnapshot = snapshot
        return
      }
      this.applySnapshot(snapshot)
    })
  }

  dispose(): void {
    this.unsubscribe()
  }

  setFollowingOutput(following: boolean): void {
    if (this.followingOutput === following) return
    this.followingOutput = following
    if (!following || this.pendingSnapshot === undefined) return
    const snapshot = this.pendingSnapshot
    this.pendingSnapshot = undefined
    this.applySnapshot(snapshot)
  }

  override render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const body = this.renderBody(safeWidth)
    const prompt = this.prompt.render(safeWidth)
    if (this.renderCache?.body === body && sameLines(this.renderCache.prompt, prompt)) {
      return this.renderCache.lines
    }
    const lines = [...body, ...prompt]
    this.renderCache = { body, prompt, lines }
    return lines
  }

  private renderBody(width: number): string[] {
    if (this.bodyCache?.snapshot === this.snapshot && this.bodyCache.width === width) return this.bodyCache.lines
    const safeWidth = Math.max(1, width)
    const lines = new Welcome(this.snapshot).render(safeWidth)
    const transcript = this.transcript.render(safeWidth)
    if (transcript.length > 0) {
      if (lines.length > 0) lines.push('')
      lines.push(...transcript)
    }
    if (this.snapshot.notice !== undefined) {
      if (lines.length > 0) lines.push('')
      lines.push(...wrapPlain(`! ${this.snapshot.notice}`, safeWidth).map((line) => theme.warning(line)))
    }
    if (this.snapshot.lifecycle === 'closing') {
      if (lines.length > 0) lines.push('')
      lines.push(theme.dim('Closing session…'))
    }
    if (lines.length > 0) lines.push('')
    lines.push(theme.border('─'.repeat(safeWidth)))
    lines.push(...new StatusLine(this.snapshot).render(safeWidth))
    this.bodyCache = { snapshot: this.snapshot, width: safeWidth, lines }
    return lines
  }

  private applySnapshot(snapshot: TuiSnapshot): void {
    this.pendingSnapshot = undefined
    this.snapshot = snapshot
    this.transcript.setSnapshot(snapshot)
    this.invalidate()
    this.tui.requestRender()
  }
}

function sameLines(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index])
}
