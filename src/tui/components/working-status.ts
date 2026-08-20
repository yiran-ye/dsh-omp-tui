import { Loader, type TUI } from '@earendil-works/pi-tui'
import type { ToolPresenter } from '../../runtime/tool-presentation.js'
import type { AssistantTranscriptEntry, TuiSnapshot } from '../state.js'
import { theme } from '../theme.js'
import { fitLines } from './common.js'

export function resolveWorkingActivity(snapshot: TuiSnapshot, tools: ToolPresenter): string | undefined {
  if (snapshot.status !== 'running' || snapshot.lifecycle !== 'active') return undefined

  for (let index = snapshot.transcript.length - 1; index >= 0; index--) {
    const entry = snapshot.transcript[index]
    if (entry?.kind !== 'tool' || entry.status !== 'running') continue
    const title = tools.presentSummary(entry).title.trim()
    return title.length > 0 ? title : entry.name
  }

  const streaming = [...snapshot.transcript].reverse().find(
    (entry): entry is AssistantTranscriptEntry => entry.kind === 'assistant' && entry.streaming,
  )
  if (streaming !== undefined) {
    const tail = streaming.blocks.at(-1)?.kind
    if (tail === 'reasoning' || (streaming.reasoning.length > 0 && streaming.text.length === 0)) {
      return '正在思考'
    }
    return '正在生成回复'
  }

  return '正在准备下一步'
}

export class WorkingStatus {
  private readonly loader: Loader
  private active = false
  private message = ''

  constructor(tui: TUI) {
    this.loader = new Loader(tui, theme.warning, (text) => text, '')
    this.loader.stop()
  }

  setActivity(activity: string | undefined): void {
    if (activity === undefined) {
      this.active = false
      this.message = ''
      this.loader.stop()
      return
    }

    const message = `${theme.text(activity)} ${theme.muted('⟨esc⟩')}`
    if (message !== this.message) {
      this.message = message
      this.loader.setMessage(message)
    }
    if (!this.active) {
      this.active = true
      this.loader.start()
    }
  }

  render(width: number): string[] {
    if (!this.active) return []
    const safeWidth = Math.max(1, width)
    return fitLines(this.loader.render(safeWidth).slice(1), safeWidth)
  }

  dispose(): void {
    this.active = false
    this.loader.stop()
  }
}
