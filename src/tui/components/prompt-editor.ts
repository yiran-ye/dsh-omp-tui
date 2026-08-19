import { Container, CURSOR_MARKER, Editor, type TUI } from '@earendil-works/pi-tui'
import { editorTheme, theme } from '../theme.js'
import { fitLine, padLine } from './common.js'

export class PromptEditor extends Container {
  readonly input: Editor

  constructor(tui: TUI, onSubmit: (text: string) => void) {
    super()
    this.input = new Editor(tui, editorTheme, { paddingX: 1, autocompleteMaxVisible: 6 })
    this.input.onSubmit = onSubmit
    this.addChild(this.input)
  }

  override render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    if (safeWidth < 4) return this.input.render(safeWidth).map((line) => fitLine(line, safeWidth))
    const innerWidth = safeWidth - 2
    const rendered = this.input.render(innerWidth)
    if (rendered.length < 2) return rendered.map((line) => fitLine(line, safeWidth))
    const lines: string[] = []
    for (let index = 0; index < rendered.length; index++) {
      const line = rendered[index] ?? ''
      if (index === 0) {
        lines.push(theme.border(`╭${'─'.repeat(innerWidth)}╮`))
      } else if (index === rendered.length - 1) {
        lines.push(theme.border(`╰${'─'.repeat(innerWidth)}╯`))
      } else {
        const placeholder = this.input.getText().length === 0 && index === 1
          ? `${CURSOR_MARKER} ${theme.dim('输入任务…')}`
          : line
        lines.push(`${theme.border('│')}${padLine(placeholder, innerWidth)}${theme.border('│')}`)
      }
    }
    return lines.map((line) => fitLine(line, safeWidth))
  }
}
