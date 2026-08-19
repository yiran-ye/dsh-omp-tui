import { SelectList, type Component } from '@earendil-works/pi-tui'
import type { CatalogOverlayItem } from '../state.js'
import { selectListTheme, theme } from '../theme.js'
import { fitLines, wrapPlain } from './common.js'
import { renderOverlayFrame } from './overlay-frame.js'

/** A compact, keyboard-first catalog picker shared by Skills and MCP tools. */
export class CatalogDialog implements Component {
  private readonly choices: SelectList

  constructor(
    private readonly title: string,
    private readonly body: string | undefined,
    items: readonly CatalogOverlayItem[],
    onSelect: (value: string) => void,
    onCancel: () => void,
    selected = 0,
  ) {
    this.choices = new SelectList([...items], Math.min(12, Math.max(2, items.length)), selectListTheme)
    this.choices.setSelectedIndex(selected)
    this.choices.onSelect = (item) => onSelect(item.value)
    this.choices.onCancel = onCancel
  }

  invalidate(): void {
    this.choices.invalidate()
  }

  handleInput(data: string): void {
    this.choices.handleInput(data)
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const bodyWidth = Math.max(1, safeWidth - 4)
    const body = [
      ...(this.body === undefined ? [] : wrapPlain(this.body, bodyWidth)),
      ...(this.body === undefined ? [] : ['']),
      ...this.choices.render(bodyWidth),
      '',
      theme.dim('↑/↓ 选择 · Enter 确认 · Esc 关闭'),
    ]
    return fitLines(renderOverlayFrame(this.title, body, safeWidth), safeWidth)
  }
}
