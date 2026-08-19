import {
  CombinedAutocompleteProvider,
  Container,
  CURSOR_MARKER,
  Editor,
  stripTerminalSequences,
  visibleWidth,
  type SlashCommand as AutocompleteSlashCommand,
  type TUI,
} from '@earendil-works/pi-tui'
import { SLASH_COMMAND_AUTOCOMPLETE_ITEMS } from '../commands.js'
import { editorTheme, theme } from '../theme.js'
import { fitLine, padLine } from './common.js'

export class PromptEditor extends Container {
  readonly input: Editor

  constructor(tui: TUI, onSubmit: (text: string) => void) {
    super()
    this.input = new Editor(tui, editorTheme, { paddingX: 1, autocompleteMaxVisible: 6 })
    this.setSlashCommands(SLASH_COMMAND_AUTOCOMPLETE_ITEMS)
    this.input.onSubmit = onSubmit
    this.addChild(this.input)
  }

  setSlashCommands(commands: readonly AutocompleteSlashCommand[]): void {
    this.input.setAutocompleteProvider(new CombinedAutocompleteProvider([...commands], process.cwd()))
  }

  override render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    if (safeWidth < 4) return this.input.render(safeWidth).map((line) => fitLine(line, safeWidth))
    const innerWidth = safeWidth - 2
    const rendered = this.input.render(innerWidth)
    if (rendered.length < 2) return rendered.map((line) => fitLine(line, safeWidth))
    const editorBottomIndex = rendered.findLastIndex((line, index) => (
      index > 0 && isEditorBottomBorder(line, innerWidth)
    ))
    if (editorBottomIndex < 0) return rendered.map((line) => fitLine(line, safeWidth))
    const lines: string[] = []
    for (let index = 0; index < editorBottomIndex; index++) {
      const line = rendered[index] ?? ''
      if (index === 0) {
        lines.push(theme.border(`╭${'─'.repeat(innerWidth)}╮`))
      } else {
        const placeholder = this.input.getText().length === 0 && index === 1
          ? `${CURSOR_MARKER} ${theme.dim('输入任务…')}`
          : line
        lines.push(`${theme.border('│')}${padLine(placeholder, innerWidth)}${theme.border('│')}`)
      }
    }
    lines.push(theme.border(`╰${'─'.repeat(innerWidth)}╯`))
    lines.push(...rendered.slice(editorBottomIndex + 1).map((line) => fitLine(line, safeWidth)))
    return lines.map((line) => fitLine(line, safeWidth))
  }
}

function isEditorBottomBorder(line: string, width: number): boolean {
  const plain = stripTerminalSequences(line)
  return visibleWidth(plain) === width && (/^─+$/.test(plain) || plain.startsWith('─── ↓ '))
}
