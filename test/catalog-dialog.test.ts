import { stripTerminalSequences } from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vitest'
import { CatalogDialog } from '../src/tui/components/catalog-dialog.js'

describe('目录选择 Overlay', () => {
  it('确认选择并支持取消', () => {
    const select = vi.fn<(value: string) => void>()
    const cancel = vi.fn<() => void>()
    const dialog = new CatalogDialog(
      'Skills',
      '选择一个 Skill。',
      [{ value: 'release-notes', label: 'release-notes', description: '生成发布说明' }],
      select,
      cancel,
    )

    expect(dialog.render(48).map(stripTerminalSequences).join('\n')).toContain('release-notes')
    dialog.handleInput('\r')
    expect(select).toHaveBeenCalledWith('release-notes')
    dialog.handleInput('\u001b')
    expect(cancel).toHaveBeenCalledOnce()
  })
})
