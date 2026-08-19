import { visibleWidth } from '@earendil-works/pi-tui'
import { theme } from '../theme.js'
import { fitLine, padLine } from './common.js'

export function renderOverlayFrame(title: string, body: readonly string[], width: number): string[] {
  const safeWidth = Math.max(1, width)
  if (safeWidth < 6) return body.map((line) => fitLine(line, safeWidth))
  const innerWidth = safeWidth - 2
  const label = ` ${title} `
  const labelWidth = Math.min(innerWidth, visibleWidth(label))
  const top = `╭${fitLine(theme.bold(theme.accent(label)), innerWidth)}${'─'.repeat(Math.max(0, innerWidth - labelWidth))}╮`
  return [
    fitLine(theme.border(top), safeWidth),
    ...body.map((line) => `${theme.border('│')}${padLine(line, innerWidth)}${theme.border('│')}`),
    theme.border(`╰${'─'.repeat(innerWidth)}╯`),
  ]
}
