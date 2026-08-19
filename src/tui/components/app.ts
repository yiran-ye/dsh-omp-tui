import { Container, type TUI } from '@earendil-works/pi-tui'
import type { ToolPresenter } from '../../runtime/tool-presentation.js'
import type { TuiStore } from '../store.js'
import type { TuiSnapshot } from '../state.js'
import { theme } from '../theme.js'
import { fitLines, wrapPlain } from './common.js'
import { PromptEditor } from './prompt-editor.js'
import { StatusLine } from './status-line.js'
import { Transcript } from './transcript.js'
import { Welcome } from './welcome.js'

export class App extends Container {
  readonly prompt: PromptEditor
  private snapshot: TuiSnapshot
  private readonly unsubscribe: () => void

  constructor(
    private readonly tui: TUI,
    store: TuiStore,
    private readonly tools: ToolPresenter,
    onSubmit: (text: string) => void,
  ) {
    super()
    this.snapshot = store.getSnapshot()
    this.prompt = new PromptEditor(tui, onSubmit)
    this.addChild(this.prompt)
    this.unsubscribe = store.subscribe((snapshot) => {
      this.snapshot = snapshot
      this.invalidate()
      this.tui.requestRender()
    })
  }

  dispose(): void {
    this.unsubscribe()
  }

  override render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const lines = new Welcome(this.snapshot).render(safeWidth)
    const transcript = new Transcript(this.snapshot, this.tools).render(safeWidth)
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
    lines.push(...this.prompt.render(safeWidth))
    return fitLines(lines, safeWidth)
  }
}
